/**
 * @feature CLOUD-13 Local copy of cloud data, kept apart by host
 * Owns: removing every row that belongs to one cloud host, in one transaction.
 * Behaviour: services-map.md 2.6.2 (the local mirror of everything that belongs to a cloud host
 * is removed with it). Our design choice: one database and one home for the host (D103).
 * Must handle: the host lives only on `workspaces`; sessions, session_events,
 * session_live_state, diff_comments and terminals reference their workspace or chat with
 * ON DELETE CASCADE (0001_init.sql and 0004), so deleting the host's workspaces removes them in
 * the same transaction. The local host is refused, because removing it would delete this Mac's
 * own data; a second call changes nothing.
 * Test first: removing a cloud host deletes its rows in every table and leaves local rows alone.
 */
import type { Host } from "@conducted/protocol";
import { appError, err, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import { executeVoid, inTransaction } from "./row-codec.ts";

/**
 * A cloud host's workspaces. Their child rows go with them by the foreign keys' cascade; every
 * table that must go names `workspaces` or `sessions` with ON DELETE CASCADE.
 */
const DELETE_WORKSPACES_SQL = `DELETE FROM workspaces
	WHERE host_kind = 'cloud' AND host_url = $1 AND host_vm_id = $2`;

export interface HostCopyRepository {
	// unwired: CLOUD-13 the cloud host removal flow has no caller yet.
	/** Deletes every workspace of `host` in one transaction; the local host is refused. */
	remove(host: Host): Promise<Result<void>>;
}

export function createHostCopyRepository(db: Database, _deps: RepositoryDeps): HostCopyRepository {
	return {
		remove: async (host) => {
			if (host.kind === "local") {
				return err(
					appError("db.invalid_host", "Only a cloud host's rows can be removed as a copy."),
				);
			}
			return inTransaction(db, "Removing a cloud host's rows", async (tx) =>
				executeVoid(
					tx,
					DELETE_WORKSPACES_SQL,
					[host.url, host.vmId],
					"Removing a cloud host's workspaces",
				),
			);
		},
	};
}
