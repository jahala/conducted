/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: the `port_forwards` table and the two forwarding switches on a workspace: one row per
 * remote port carried to one local port, and whether the workspace forwards or discovers ports.
 * Behaviour: services-map.md 5A.3.3 (Conductor's table: id, workspace_id, remote_port, local_port,
 * protocol 'tcp', label, enabled, created_at, auto_detected; local_port unique on the machine;
 * (workspace_id, remote_port) unique) and 2.7.1 (rows removed on archive or delete). Our own
 * `position` column keeps the order the user set by moving a forward up or down.
 * Must handle: a duplicate remote port or local port is refused by the unique indexes and comes
 * back as an error Result; a row of a workspace that is archived or gone is removed on startup;
 * a bad flag reads as false; deleting a workspace cascades its rows.
 * Our design choice: the switches live on `workspaces` (migration 0014), as Conductor keeps them,
 * so they have one home, but the model type does not gain two fields no other screen reads. The
 * service reads them through this repository.
 * Test first: a second row with the same local port fails, and a missing workspace has both
 * switches off.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	collectResults,
	executeStatement,
	executeVoid,
	fromFlag,
	selectRows,
	toFlag,
} from "./row-codec.ts";

export interface PortForward {
	id: string;
	workspaceId: WorkspaceId;
	remotePort: number;
	localPort: number;
	protocol: "tcp";
	label: string | null;
	autoDetected: boolean;
	enabled: boolean;
	/** Its place in the Forward ports popover; the user can move it up or down. */
	position: number;
	createdAt: number;
}

export interface PortForwardRow {
	id: string;
	workspace_id: WorkspaceId;
	remote_port: number;
	local_port: number;
	protocol: string;
	label: string | null;
	auto_detected: number;
	enabled: number;
	position: number;
	created_at: number;
}

/** The per-workspace switches. A workspace with no row yet has both off. */
export interface PortForwardingFlags {
	forwardingEnabled: boolean;
	autoForwardEnabled: boolean;
}

export function portForwardFromRow(row: PortForwardRow): Result<PortForward> {
	if (row.protocol !== "tcp") {
		return err(appError("db.invalid_port_forward", "port_forwards.protocol must be tcp"));
	}
	return {
		ok: true,
		value: {
			id: row.id,
			workspaceId: row.workspace_id,
			remotePort: row.remote_port,
			localPort: row.local_port,
			protocol: "tcp",
			label: row.label,
			autoDetected: fromFlag(row.auto_detected),
			enabled: fromFlag(row.enabled),
			position: row.position,
			createdAt: row.created_at,
		},
	};
}

/** Parameters for PORT_FORWARDS_SQL.insert, in column order. */
export function portForwardToParams(forward: PortForward): readonly unknown[] {
	return [
		forward.id,
		forward.workspaceId,
		forward.remotePort,
		forward.localPort,
		forward.protocol,
		forward.label,
		toFlag(forward.autoDetected),
		toFlag(forward.enabled),
		forward.position,
		forward.createdAt,
	];
}

const COLUMNS = `id, workspace_id, remote_port, local_port, protocol, label, auto_detected,
	enabled, position, created_at`;

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const PORT_FORWARDS_SQL = {
	listAll: `SELECT ${COLUMNS} FROM port_forwards ORDER BY workspace_id, position, remote_port, id`,
	get: `SELECT ${COLUMNS} FROM port_forwards WHERE id = $1`,
	listLocalPorts: "SELECT local_port FROM port_forwards",
	insert: `INSERT INTO port_forwards (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
	setEnabled: "UPDATE port_forwards SET enabled = $1 WHERE id = $2",
	setLocalPort: "UPDATE port_forwards SET local_port = $1 WHERE id = $2",
	setPosition: "UPDATE port_forwards SET position = $1 WHERE id = $2",
	delete: "DELETE FROM port_forwards WHERE id = $1",
	deleteForWorkspace: "DELETE FROM port_forwards WHERE workspace_id = $1",
	/** Rows of archived workspaces, or of workspaces that no longer exist, are removed at startup. */
	deleteArchivedOrMissing: `DELETE FROM port_forwards WHERE workspace_id NOT IN
		(SELECT id FROM workspaces WHERE state <> 'archived')`,
	getFlags: `SELECT port_forwarding_enabled, auto_forward_enabled FROM workspaces WHERE id = $1`,
	setForwarding: `UPDATE workspaces SET port_forwarding_enabled = $1, updated_at = $2
		WHERE id = $3`,
	setAutoForward: `UPDATE workspaces SET auto_forward_enabled = $1, updated_at = $2 WHERE id = $3`,
} as const;

export interface PortForwardRepository {
	/** PORT_FORWARDS_SQL.listAll, for the startup sweep and the service's store. */
	listAll(): Promise<Result<PortForward[]>>;
	get(id: string): Promise<Result<PortForward | null>>;
	/** The local ports the table already owns, so allocation never picks one. */
	localPorts(): Promise<Result<number[]>>;
	add(
		input: Omit<PortForward, "id" | "createdAt" | "protocol"> & { protocol?: "tcp" },
	): Promise<Result<PortForward>>;
	setEnabled(id: string, enabled: boolean): Promise<Result<void>>;
	/** Moves a forward to another local port, after a bind failure. */
	setLocalPort(id: string, localPort: number): Promise<Result<void>>;
	/** Moves a forward to another place in its workspace's list. */
	setPosition(id: string, position: number): Promise<Result<void>>;
	delete(id: string): Promise<Result<void>>;
	deleteForWorkspace(workspaceId: WorkspaceId): Promise<Result<void>>;
	/** Removes rows of archived workspaces and of workspaces that no longer exist. */
	removeArchivedOrMissing(): Promise<Result<void>>;
	flags(workspaceId: WorkspaceId): Promise<Result<PortForwardingFlags>>;
	setForwardingEnabled(workspaceId: WorkspaceId, enabled: boolean): Promise<Result<void>>;
	setAutoForwardEnabled(workspaceId: WorkspaceId, enabled: boolean): Promise<Result<void>>;
}

export function createPortForwardRepository(
	db: Database,
	deps: RepositoryDeps,
): PortForwardRepository {
	const read = async (sql: string, params: readonly unknown[], what: string) => {
		const rows = await selectRows<PortForwardRow>(db, sql, params, what);
		return rows.ok ? collectResults(rows.value.map(portForwardFromRow)) : err(rows.error);
	};
	return {
		listAll: () => read(PORT_FORWARDS_SQL.listAll, [], "Listing port forwards"),
		get: async (id) => {
			const rows = await selectRows<PortForwardRow>(
				db,
				PORT_FORWARDS_SQL.get,
				[id],
				"Reading a port forward",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : portForwardFromRow(row);
		},
		localPorts: async () => {
			const rows = await selectRows<{ local_port: number }>(
				db,
				PORT_FORWARDS_SQL.listLocalPorts,
				[],
				"Listing taken local ports",
			);
			return rows.ok ? ok(rows.value.map((row) => row.local_port)) : err(rows.error);
		},
		add: async (input) => {
			const forward: PortForward = {
				...input,
				id: deps.ids.uuid(),
				protocol: "tcp",
				createdAt: deps.clock.now(),
			};
			const written = await executeStatement(
				db,
				PORT_FORWARDS_SQL.insert,
				portForwardToParams(forward),
				"Saving a port forward",
			);
			return written.ok ? ok(forward) : err(written.error);
		},
		setEnabled: (id, enabled) =>
			executeVoid(
				db,
				PORT_FORWARDS_SQL.setEnabled,
				[toFlag(enabled), id],
				"Toggling a port forward",
			),
		setLocalPort: (id, localPort) =>
			executeVoid(
				db,
				PORT_FORWARDS_SQL.setLocalPort,
				[localPort, id],
				"Moving a port forward to another local port",
			),
		setPosition: (id, position) =>
			executeVoid(
				db,
				PORT_FORWARDS_SQL.setPosition,
				[position, id],
				"Moving a port forward in the list",
			),
		delete: (id) => executeVoid(db, PORT_FORWARDS_SQL.delete, [id], "Removing a port forward"),
		deleteForWorkspace: (workspaceId) =>
			executeVoid(
				db,
				PORT_FORWARDS_SQL.deleteForWorkspace,
				[workspaceId],
				"Removing a workspace's port forwards",
			),
		removeArchivedOrMissing: () =>
			executeVoid(
				db,
				PORT_FORWARDS_SQL.deleteArchivedOrMissing,
				[],
				"Removing stale port forwards",
			),
		flags: async (workspaceId) => {
			const rows = await selectRows<{
				port_forwarding_enabled: number;
				auto_forward_enabled: number;
			}>(
				db,
				PORT_FORWARDS_SQL.getFlags,
				[workspaceId],
				"Reading a workspace's forwarding switches",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return ok({
				forwardingEnabled: row === undefined ? false : fromFlag(row.port_forwarding_enabled),
				autoForwardEnabled: row === undefined ? false : fromFlag(row.auto_forward_enabled),
			});
		},
		setForwardingEnabled: (workspaceId, enabled) =>
			executeVoid(
				db,
				PORT_FORWARDS_SQL.setForwarding,
				[toFlag(enabled), deps.clock.now(), workspaceId],
				"Saving a workspace's forwarding switch",
			),
		setAutoForwardEnabled: (workspaceId, enabled) =>
			executeVoid(
				db,
				PORT_FORWARDS_SQL.setAutoForward,
				[toFlag(enabled), deps.clock.now(), workspaceId],
				"Saving a workspace's auto-forward switch",
			),
	};
}
