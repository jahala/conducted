/**
 * @feature DATA-01 Repository for the workspaces table
 * Owns: every read and write of the workspaces table (one git worktree per row) and its state
 * changes.
 * Behaviour: services-map.md 2.3.1 (workspaces) and 2.4 (lifecycle state machines). Our states
 * are initializing, ready, failed, archiving, archived; kanban_status is a separate column.
 * Must handle: state changes are compare-and-set (`WHERE state = <expected>`) so two callers
 * cannot both win; a bad linked_paths column returns an error Result; a setter on a missing
 * workspace returns `db.not_found`; last_activity_at only moves forward; deleting cascades to
 * sessions, comments, terminals and section members.
 * Activity: `touchActivity` is the forward-only write a user message makes (services-map.md 2.3.1,
 * Conductor's own case statement @1054957), and `finishUnarchive` stamps the restored workspace
 * with the restore time in its own statement, as Conductor's unarchive step 2 does. Those are the
 * only two events in Conductor: its bundle reaches the touch only from the sessions-store watch on
 * `lastUserMessageAt` (@1054147). An agent turn ending does not touch it.
 * CLOUD-01: the host columns (migration 0009) read back as the workspace's `host`. A local row has
 * no URL or sandbox id and a cloud row has both; any other mix is an error Result, so a half-written
 * cloud row is never read as local.
 * CLOUD-13: the lists local work runs over (ports, folder names and the states startup repair
 * scans) hold local rows only. `listAll` stays the merged list the sidebar draws, so a cloud
 * workspace still appears with its host.
 * Test first: workspaceFromRow returns an error Result when linked_paths is not a JSON list.
 */
import type { Host } from "@conducted/protocol";
import {
	appError,
	err,
	ok,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { KanbanStatus, Workspace, WorkspaceState } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	collectResults,
	executeExisting,
	executeStatement,
	executeVoid,
	fromFlag,
	inTransaction,
	parseStringList,
	selectRows,
	stringifyJson,
	toFlag,
} from "./row-codec.ts";

export interface WorkspaceRow {
	id: WorkspaceId;
	repo_id: RepoId;
	directory_name: string;
	path: string;
	branch: string;
	branch_is_placeholder: number;
	display_name: string | null;
	target_branch: string;
	state: WorkspaceState;
	kanban_status: KanbanStatus;
	port: number;
	pinned_at: number | null;
	notes: string | null;
	linked_paths: string;
	pr_number: number | null;
	pr_title: string | null;
	pr_description: string | null;
	archive_commit: string | null;
	setup_log_path: string | null;
	archived_at: number | null;
	active_session_id: SessionId | null;
	files_copied: number | null;
	host_kind: Host["kind"];
	host_url: string | null;
	host_vm_id: string | null;
	last_activity_at: number;
	created_at: number;
	updated_at: number;
}

/**
 * The workspace model has no setup log path. Our design choice: the path stays a column read
 * through `getSetupLogPath` and written at insert, so the shared model type does not change.
 */
export type WorkspaceInsert = Workspace & { setupLogPath: string | null };

/** The host columns as a `Host`: local has neither URL nor sandbox id, cloud has both. */
export function hostFromRow(
	row: Pick<WorkspaceRow, "host_kind" | "host_url" | "host_vm_id">,
): Result<Host> {
	if (row.host_kind === "local" && row.host_url === null && row.host_vm_id === null) {
		return ok({ kind: "local" });
	}
	if (
		row.host_kind === "cloud" &&
		row.host_url !== null &&
		row.host_url !== "" &&
		row.host_vm_id !== null &&
		row.host_vm_id !== ""
	) {
		return ok({ kind: "cloud", url: row.host_url, vmId: row.host_vm_id });
	}
	return err(
		appError(
			"db.invalid_host",
			"workspaces.host_* must be local with no URL or sandbox, or cloud with both",
		),
	);
}

/** A `Host` as the three host columns, in column order. */
const hostToParams = (host: Host): readonly [Host["kind"], string | null, string | null] =>
	host.kind === "local" ? ["local", null, null] : ["cloud", host.url, host.vmId];

export function workspaceFromRow(row: WorkspaceRow): Result<Workspace> {
	const linkedPaths = parseStringList(row.linked_paths, "workspaces.linked_paths");
	if (!linkedPaths.ok) return linkedPaths;
	const host = hostFromRow(row);
	if (!host.ok) return host;
	return {
		ok: true,
		value: {
			id: row.id,
			repoId: row.repo_id,
			directoryName: row.directory_name,
			path: row.path,
			branch: row.branch,
			branchIsPlaceholder: fromFlag(row.branch_is_placeholder),
			displayName: row.display_name,
			targetBranch: row.target_branch,
			state: row.state,
			kanbanStatus: row.kanban_status,
			port: row.port,
			pinnedAt: row.pinned_at,
			notes: row.notes,
			linkedPaths: linkedPaths.value,
			prNumber: row.pr_number,
			prTitle: row.pr_title,
			prDescription: row.pr_description,
			archiveCommit: row.archive_commit,
			archivedAt: row.archived_at,
			activeSessionId: row.active_session_id,
			filesCopied: row.files_copied,
			host: host.value,
			lastActivityAt: row.last_activity_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		},
	};
}

/** Parameters for WORKSPACES_SQL.insert, in column order. */
export function workspaceToParams(workspace: WorkspaceInsert): Result<readonly unknown[]> {
	const linkedPaths = stringifyJson(workspace.linkedPaths, "workspaces.linked_paths");
	if (!linkedPaths.ok) return linkedPaths;
	return {
		ok: true,
		value: [
			workspace.id,
			workspace.repoId,
			workspace.directoryName,
			workspace.path,
			workspace.branch,
			toFlag(workspace.branchIsPlaceholder),
			workspace.displayName,
			workspace.targetBranch,
			workspace.state,
			workspace.kanbanStatus,
			workspace.port,
			workspace.pinnedAt,
			workspace.notes,
			linkedPaths.value,
			workspace.prNumber,
			workspace.prTitle,
			workspace.prDescription,
			workspace.archiveCommit,
			workspace.setupLogPath,
			workspace.archivedAt,
			workspace.activeSessionId,
			workspace.filesCopied,
			...hostToParams(workspace.host),
			workspace.lastActivityAt,
			workspace.createdAt,
			workspace.updatedAt,
		],
	};
}

const COLUMNS = `id, repo_id, directory_name, path, branch, branch_is_placeholder, display_name,
	target_branch, state, kanban_status, port, pinned_at, notes, linked_paths, pr_number, pr_title,
	pr_description, archive_commit, setup_log_path, archived_at, active_session_id, files_copied,
	host_kind, host_url, host_vm_id, last_activity_at, created_at, updated_at`;

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const WORKSPACES_SQL = {
	listAll: `SELECT ${COLUMNS} FROM workspaces ORDER BY created_at, id`,
	listByRepo: `SELECT ${COLUMNS} FROM workspaces WHERE repo_id = $1 ORDER BY created_at, id`,
	listByState: `SELECT ${COLUMNS} FROM workspaces WHERE host_kind = 'local' AND state = $1
		ORDER BY created_at, id`,
	get: `SELECT ${COLUMNS} FROM workspaces WHERE id = $1`,
	getByPath: `SELECT ${COLUMNS} FROM workspaces WHERE path = $1`,
	getSetupLogPath: "SELECT setup_log_path FROM workspaces WHERE id = $1",
	listDirectoryNames: `SELECT directory_name FROM workspaces
		WHERE repo_id = $1 AND host_kind = 'local'`,
	listPorts: "SELECT port FROM workspaces WHERE host_kind = 'local'",
	insert: `INSERT INTO workspaces (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
		$11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
	transitionState: "UPDATE workspaces SET state = $1, updated_at = $2 WHERE id = $3 AND state = $4",
	markArchived: `UPDATE workspaces SET state = 'archived', archive_commit = $1, archived_at = $2,
		updated_at = $2 WHERE id = $3 AND state = 'archiving'`,
	setKanbanStatus: "UPDATE workspaces SET kanban_status = $1, updated_at = $2 WHERE id = $3",
	setDisplayName: "UPDATE workspaces SET display_name = $1, updated_at = $2 WHERE id = $3",
	setBranch: `UPDATE workspaces SET branch = $1, branch_is_placeholder = $2, updated_at = $3
		WHERE id = $4`,
	setTargetBranch: "UPDATE workspaces SET target_branch = $1, updated_at = $2 WHERE id = $3",
	setPinned: "UPDATE workspaces SET pinned_at = $1, updated_at = $2 WHERE id = $3",
	setNotes: "UPDATE workspaces SET notes = $1, updated_at = $2 WHERE id = $3",
	setLinkedPaths: "UPDATE workspaces SET linked_paths = $1, updated_at = $2 WHERE id = $3",
	setPullRequest: `UPDATE workspaces SET pr_number = $1, pr_title = $2, pr_description = $3,
		updated_at = $4 WHERE id = $5`,
	clearPullRequest: `UPDATE workspaces SET pr_number = NULL, pr_title = NULL,
		pr_description = NULL, updated_at = $1 WHERE id = $2`,
	setSetupLogPath: "UPDATE workspaces SET setup_log_path = $1, updated_at = $2 WHERE id = $3",
	setActiveSession: "UPDATE workspaces SET active_session_id = $1 WHERE id = $2",
	setFilesCopied: "UPDATE workspaces SET files_copied = $1, updated_at = $2 WHERE id = $3",
	finishUnarchive: `UPDATE workspaces SET state = 'ready', branch = $1, directory_name = $2,
		path = $3, last_activity_at = MAX(last_activity_at, $4), archived_at = NULL, updated_at = $4
		WHERE id = $5 AND state = 'initializing'`,
	touchActivity: "UPDATE workspaces SET last_activity_at = MAX(last_activity_at, $1) WHERE id = $2",
	delete: "DELETE FROM workspaces WHERE id = $1",
} as const;

/** What a caller supplies to add a workspace. The repository adds id, state and times. */
export interface NewWorkspace {
	repoId: RepoId;
	directoryName: string;
	path: string;
	branch: string;
	branchIsPlaceholder: boolean;
	targetBranch: string;
	port: number;
	linkedPaths: string[];
	setupLogPath: string | null;
	/** Where it lives (CLOUD-01). A workspace made on the Mac is `LOCAL_HOST`. */
	host: Host;
}

export interface WorkspaceRepository {
	/** WORKSPACES_SQL.listAll, the merged list of both hosts. */
	listAll(): Promise<Result<Workspace[]>>;
	/** WORKSPACES_SQL.listByRepo. */
	listByRepo(repoId: RepoId): Promise<Result<Workspace[]>>;
	/**
	 * WORKSPACES_SQL.listByState, local rows only. Startup repair and the local archive flow use
	 * it; a cloud workspace's state comes from its host (CLOUD-13).
	 */
	listByState(state: WorkspaceState): Promise<Result<Workspace[]>>;
	/** WORKSPACES_SQL.get. A missing workspace is `ok(null)`. */
	get(id: WorkspaceId): Promise<Result<Workspace | null>>;
	/** WORKSPACES_SQL.getByPath. */
	getByPath(path: string): Promise<Result<Workspace | null>>;
	/** WORKSPACES_SQL.getSetupLogPath. `ok(null)` when the workspace is missing or has no log. */
	getSetupLogPath(id: WorkspaceId): Promise<Result<string | null>>;
	/** WORKSPACES_SQL.listDirectoryNames, local rows only, so the name generator avoids them. */
	listDirectoryNames(repoId: RepoId): Promise<Result<string[]>>;
	/** WORKSPACES_SQL.listPorts, local rows only, so the port allocator avoids them. */
	listPorts(): Promise<Result<number[]>>;
	/**
	 * WORKSPACES_SQL.insert with state `initializing` and kanban status `in_progress`. A duplicate
	 * path or (repo, directory name) returns the error code `db.conflict`.
	 */
	create(input: NewWorkspace): Promise<Result<Workspace>>;
	/**
	 * WORKSPACES_SQL.transitionState. Compare-and-set: `ok(false)` when the row was not in the
	 * `from` state (someone else moved it first), `ok(true)` when it changed.
	 */
	transitionState(
		id: WorkspaceId,
		from: WorkspaceState,
		to: WorkspaceState,
	): Promise<Result<boolean>>;
	/**
	 * WORKSPACES_SQL.markArchived, with archived_at and updated_at from the clock. Only applies to a
	 * workspace in `archiving`; `ok(false)` otherwise.
	 */
	markArchived(id: WorkspaceId, archiveCommit: string | null): Promise<Result<boolean>>;
	/** WORKSPACES_SQL.setKanbanStatus. A missing workspace is `db.not_found`. */
	setKanbanStatus(id: WorkspaceId, status: KanbanStatus): Promise<Result<void>>;
	/**
	 * WORKSPACES_SQL.setDisplayName. `null` goes back to the PR title or branch. A missing
	 * workspace is `db.not_found`.
	 */
	setDisplayName(id: WorkspaceId, name: string | null): Promise<Result<void>>;
	/**
	 * WORKSPACES_SQL.setBranch. The placeholder flag is whatever the caller passes; renaming a
	 * branch does not change it on its own. A missing workspace is `db.not_found`.
	 */
	setBranch(id: WorkspaceId, branch: string, isPlaceholder: boolean): Promise<Result<void>>;
	/** WORKSPACES_SQL.setTargetBranch. A missing workspace is `db.not_found`. */
	setTargetBranch(id: WorkspaceId, targetBranch: string): Promise<Result<void>>;
	/** WORKSPACES_SQL.setPinned. `null` unpins. A missing workspace is `db.not_found`. */
	setPinned(id: WorkspaceId, pinnedAt: number | null): Promise<Result<void>>;
	/** WORKSPACES_SQL.setNotes. A missing workspace is `db.not_found`. */
	setNotes(id: WorkspaceId, notes: string | null): Promise<Result<void>>;
	/**
	 * WORKSPACES_SQL.setLinkedPaths. The list is written as a JSON array. A missing workspace is
	 * `db.not_found`.
	 */
	setLinkedPaths(id: WorkspaceId, paths: readonly string[]): Promise<Result<void>>;
	/** WORKSPACES_SQL.setPullRequest. A missing workspace is `db.not_found`. */
	setPullRequest(
		id: WorkspaceId,
		pr: { number: number; title: string | null; description: string | null },
	): Promise<Result<void>>;
	/** WORKSPACES_SQL.clearPullRequest. A missing workspace is `db.not_found`. */
	clearPullRequest(id: WorkspaceId): Promise<Result<void>>;
	/** WORKSPACES_SQL.setSetupLogPath. A missing workspace is `db.not_found`. */
	setSetupLogPath(id: WorkspaceId, path: string | null): Promise<Result<void>>;
	/** WORKSPACES_SQL.setActiveSession: the chat tab to reopen after a restart. */
	setActiveSession(id: WorkspaceId, sessionId: SessionId | null): Promise<Result<void>>;
	/** WORKSPACES_SQL.setFilesCopied, after setup copied files into the new worktree. */
	setFilesCopied(id: WorkspaceId, count: number): Promise<Result<void>>;
	/**
	 * WORKSPACES_SQL.finishUnarchive: makes the restored worktree the workspace's branch, folder and
	 * path, sets it ready, clears archived_at and moves last_activity_at to the restore time (never
	 * back). Only applies while the row is `initializing`; `ok(false)` otherwise.
	 */
	finishUnarchive(
		id: WorkspaceId,
		input: { branch: string; directoryName: string; path: string },
	): Promise<Result<boolean>>;
	/** WORKSPACES_SQL.touchActivity. Moves last_activity_at forward only, never back. */
	touchActivity(id: WorkspaceId, at: number): Promise<Result<void>>;
	/** WORKSPACES_SQL.delete. The database cascades to sessions, comments and terminals. */
	delete(id: WorkspaceId): Promise<Result<void>>;
}

export function createWorkspaceRepository(db: Database, deps: RepositoryDeps): WorkspaceRepository {
	const now = (): number => deps.clock.now();
	const list = async (sql: string, params: readonly unknown[]): Promise<Result<Workspace[]>> => {
		const rows = await selectRows<WorkspaceRow>(db, sql, params, "Listing workspaces");
		return rows.ok ? collectResults(rows.value.map(workspaceFromRow)) : err(rows.error);
	};
	const find = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<Workspace | null>> => {
		const rows = await selectRows<WorkspaceRow>(db, sql, params, what);
		if (!rows.ok) return err(rows.error);
		const row = rows.value[0];
		return row === undefined ? ok(null) : workspaceFromRow(row);
	};
	return {
		listAll: () => list(WORKSPACES_SQL.listAll, []),
		listByRepo: (repoId) => list(WORKSPACES_SQL.listByRepo, [repoId]),
		listByState: (state) => list(WORKSPACES_SQL.listByState, [state]),
		get: (id) => find(WORKSPACES_SQL.get, [id], "Reading a workspace"),
		getByPath: (path) => find(WORKSPACES_SQL.getByPath, [path], "Reading a workspace by folder"),
		getSetupLogPath: async (id) => {
			const rows = await selectRows<{ setup_log_path: string | null }>(
				db,
				WORKSPACES_SQL.getSetupLogPath,
				[id],
				"Reading a workspace setup log",
			);
			if (!rows.ok) return err(rows.error);
			return ok(rows.value[0]?.setup_log_path ?? null);
		},
		listDirectoryNames: async (repoId) => {
			const rows = await selectRows<{ directory_name: string }>(
				db,
				WORKSPACES_SQL.listDirectoryNames,
				[repoId],
				"Listing workspace folder names",
			);
			return rows.ok ? ok(rows.value.map((row) => row.directory_name)) : err(rows.error);
		},
		listPorts: async () => {
			const rows = await selectRows<{ port: number }>(
				db,
				WORKSPACES_SQL.listPorts,
				[],
				"Listing workspace ports",
			);
			return rows.ok ? ok(rows.value.map((row) => row.port)) : err(rows.error);
		},
		create: async (input) =>
			inTransaction(db, "Creating a workspace", async (tx) => {
				const at = now();
				const workspace: Workspace = {
					id: deps.ids.uuid() as WorkspaceId,
					repoId: input.repoId,
					directoryName: input.directoryName,
					path: input.path,
					branch: input.branch,
					branchIsPlaceholder: input.branchIsPlaceholder,
					displayName: null,
					targetBranch: input.targetBranch,
					state: "initializing",
					kanbanStatus: "in_progress",
					port: input.port,
					pinnedAt: null,
					notes: null,
					linkedPaths: [...input.linkedPaths],
					prNumber: null,
					prTitle: null,
					prDescription: null,
					archiveCommit: null,
					archivedAt: null,
					activeSessionId: null,
					filesCopied: null,
					host: input.host,
					lastActivityAt: at,
					createdAt: at,
					updatedAt: at,
				};
				const params = workspaceToParams({ ...workspace, setupLogPath: input.setupLogPath });
				if (!params.ok) return err(params.error);
				const written = await executeStatement(
					tx,
					WORKSPACES_SQL.insert,
					params.value,
					"Creating a workspace",
				);
				return written.ok ? ok(workspace) : err(written.error);
			}),
		transitionState: async (id, from, to) => {
			const written = await executeStatement(
				db,
				WORKSPACES_SQL.transitionState,
				[to, now(), id, from],
				"Changing a workspace state",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		markArchived: async (id, archiveCommit) => {
			const at = now();
			const written = await executeStatement(
				db,
				WORKSPACES_SQL.markArchived,
				[archiveCommit, at, id],
				"Archiving a workspace",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		setKanbanStatus: (id, status) =>
			executeExisting(
				db,
				WORKSPACES_SQL.setKanbanStatus,
				[status, now(), id],
				"Changing a board status",
			),
		setDisplayName: (id, name) =>
			executeExisting(db, WORKSPACES_SQL.setDisplayName, [name, now(), id], "Renaming a workspace"),
		setBranch: (id, branch, isPlaceholder) =>
			executeExisting(
				db,
				WORKSPACES_SQL.setBranch,
				[branch, toFlag(isPlaceholder), now(), id],
				"Changing a workspace branch",
			),
		setTargetBranch: (id, targetBranch) =>
			executeExisting(
				db,
				WORKSPACES_SQL.setTargetBranch,
				[targetBranch, now(), id],
				"Changing a target branch",
			),
		setPinned: (id, pinnedAt) =>
			executeExisting(db, WORKSPACES_SQL.setPinned, [pinnedAt, now(), id], "Pinning a workspace"),
		setNotes: (id, notes) =>
			executeExisting(db, WORKSPACES_SQL.setNotes, [notes, now(), id], "Changing workspace notes"),
		setLinkedPaths: async (id, paths) => {
			const json = stringifyJson(paths, "workspaces.linked_paths");
			if (!json.ok) return err(json.error);
			return executeExisting(
				db,
				WORKSPACES_SQL.setLinkedPaths,
				[json.value, now(), id],
				"Changing linked folders",
			);
		},
		setPullRequest: (id, pr) =>
			executeExisting(
				db,
				WORKSPACES_SQL.setPullRequest,
				[pr.number, pr.title, pr.description, now(), id],
				"Saving a pull request",
			),
		clearPullRequest: (id) =>
			executeExisting(db, WORKSPACES_SQL.clearPullRequest, [now(), id], "Clearing a pull request"),
		setSetupLogPath: (id, path) =>
			executeExisting(
				db,
				WORKSPACES_SQL.setSetupLogPath,
				[path, now(), id],
				"Saving a setup log path",
			),
		setActiveSession: (id, sessionId) =>
			executeExisting(
				db,
				WORKSPACES_SQL.setActiveSession,
				[sessionId, id],
				"Saving the active chat",
			),
		finishUnarchive: async (id, input) => {
			const written = await executeStatement(
				db,
				WORKSPACES_SQL.finishUnarchive,
				[input.branch, input.directoryName, input.path, now(), id],
				"Restoring a workspace",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		setFilesCopied: (id, count) =>
			executeExisting(
				db,
				WORKSPACES_SQL.setFilesCopied,
				[count, now(), id],
				"Saving the copied file count",
			),
		touchActivity: (id, at) =>
			executeVoid(db, WORKSPACES_SQL.touchActivity, [at, id], "Touching workspace activity"),
		delete: (id) => executeVoid(db, WORKSPACES_SQL.delete, [id], "Removing a workspace"),
	};
}
