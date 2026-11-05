/**
 * @feature DATA-01 Repository for the workspaces table
 * Owns: every read and write of the workspaces table (one git worktree per row) and its state
 * changes.
 * Behaviour: services-map.md 2.3.1 (workspaces) and 2.4 (lifecycle state machines). Our states
 * are initializing, ready, failed, archiving, archived; kanban_status is a separate column.
 * Must handle: state changes are compare-and-set (`WHERE state = <expected>`) so two callers
 * cannot both win; a bad linked_paths column returns an error Result; last_activity_at only
 * moves forward; deleting cascades to sessions, comments, terminals and section members.
 * Test first: workspaceFromRow returns an error Result when linked_paths is not a JSON list.
 */
import {
	notImplemented,
	type RepoId,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { KanbanStatus, Workspace, WorkspaceState } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import { fromFlag, parseStringList, stringifyJson, toFlag } from "./row-codec.ts";

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
	last_activity_at: number;
	created_at: number;
	updated_at: number;
}

/**
 * The workspace model has no setup log path. Our design choice: the path stays a column read
 * through `getSetupLogPath` and written at insert, so the shared model type does not change.
 */
export type WorkspaceInsert = Workspace & { setupLogPath: string | null };

export function workspaceFromRow(row: WorkspaceRow): Result<Workspace> {
	const linkedPaths = parseStringList(row.linked_paths, "workspaces.linked_paths");
	if (!linkedPaths.ok) return linkedPaths;
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
			workspace.lastActivityAt,
			workspace.createdAt,
			workspace.updatedAt,
		],
	};
}

const COLUMNS = `id, repo_id, directory_name, path, branch, branch_is_placeholder, display_name,
	target_branch, state, kanban_status, port, pinned_at, notes, linked_paths, pr_number, pr_title,
	pr_description, archive_commit, setup_log_path, archived_at, active_session_id, files_copied,
	last_activity_at, created_at, updated_at`;

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const WORKSPACES_SQL = {
	listAll: `SELECT ${COLUMNS} FROM workspaces ORDER BY created_at, id`,
	listByRepo: `SELECT ${COLUMNS} FROM workspaces WHERE repo_id = $1 ORDER BY created_at, id`,
	listByState: `SELECT ${COLUMNS} FROM workspaces WHERE state = $1 ORDER BY created_at, id`,
	get: `SELECT ${COLUMNS} FROM workspaces WHERE id = $1`,
	getByPath: `SELECT ${COLUMNS} FROM workspaces WHERE path = $1`,
	getSetupLogPath: "SELECT setup_log_path FROM workspaces WHERE id = $1",
	listDirectoryNames: "SELECT directory_name FROM workspaces WHERE repo_id = $1",
	listPorts: "SELECT port FROM workspaces",
	insert: `INSERT INTO workspaces (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
		$11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
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
}

export interface WorkspaceRepository {
	/** WORKSPACES_SQL.listAll. A row with a bad linked_paths column makes the whole call an error. */
	listAll(): Promise<Result<Workspace[]>>;
	/** WORKSPACES_SQL.listByRepo. */
	listByRepo(repoId: RepoId): Promise<Result<Workspace[]>>;
	/** WORKSPACES_SQL.listByState. Startup repair and the archive flow use it. */
	listByState(state: WorkspaceState): Promise<Result<Workspace[]>>;
	/** WORKSPACES_SQL.get. A missing workspace is `ok(null)`. */
	get(id: WorkspaceId): Promise<Result<Workspace | null>>;
	/** WORKSPACES_SQL.getByPath. */
	getByPath(path: string): Promise<Result<Workspace | null>>;
	/** WORKSPACES_SQL.getSetupLogPath. `ok(null)` when the workspace is missing or has no log. */
	getSetupLogPath(id: WorkspaceId): Promise<Result<string | null>>;
	/** WORKSPACES_SQL.listDirectoryNames, so the name generator avoids taken names. */
	listDirectoryNames(repoId: RepoId): Promise<Result<string[]>>;
	/** WORKSPACES_SQL.listPorts, so the port allocator avoids taken ports. */
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
	/** WORKSPACES_SQL.setKanbanStatus. */
	setKanbanStatus(id: WorkspaceId, status: KanbanStatus): Promise<Result<void>>;
	/** WORKSPACES_SQL.setDisplayName. `null` goes back to the PR title or branch. */
	setDisplayName(id: WorkspaceId, name: string | null): Promise<Result<void>>;
	/** WORKSPACES_SQL.setBranch. Renaming the branch also clears the placeholder flag. */
	setBranch(id: WorkspaceId, branch: string, isPlaceholder: boolean): Promise<Result<void>>;
	/** WORKSPACES_SQL.setTargetBranch. */
	setTargetBranch(id: WorkspaceId, targetBranch: string): Promise<Result<void>>;
	/** WORKSPACES_SQL.setPinned. `null` unpins. */
	setPinned(id: WorkspaceId, pinnedAt: number | null): Promise<Result<void>>;
	/** WORKSPACES_SQL.setNotes. */
	setNotes(id: WorkspaceId, notes: string | null): Promise<Result<void>>;
	/** WORKSPACES_SQL.setLinkedPaths. The list is written as a JSON array. */
	setLinkedPaths(id: WorkspaceId, paths: readonly string[]): Promise<Result<void>>;
	/** WORKSPACES_SQL.setPullRequest. */
	setPullRequest(
		id: WorkspaceId,
		pr: { number: number; title: string | null; description: string | null },
	): Promise<Result<void>>;
	/** WORKSPACES_SQL.clearPullRequest. */
	clearPullRequest(id: WorkspaceId): Promise<Result<void>>;
	/** WORKSPACES_SQL.setSetupLogPath. */
	setSetupLogPath(id: WorkspaceId, path: string | null): Promise<Result<void>>;
	/** WORKSPACES_SQL.setActiveSession: the chat tab to reopen after a restart. */
	setActiveSession(id: WorkspaceId, sessionId: SessionId | null): Promise<Result<void>>;
	/** WORKSPACES_SQL.setFilesCopied, after setup copied files into the new worktree. */
	setFilesCopied(id: WorkspaceId, count: number): Promise<Result<void>>;
	/** WORKSPACES_SQL.touchActivity. Moves last_activity_at forward only, never back. */
	touchActivity(id: WorkspaceId, at: number): Promise<Result<void>>;
	/** WORKSPACES_SQL.delete. The database cascades to sessions, comments and terminals. */
	delete(id: WorkspaceId): Promise<Result<void>>;
}

export function createWorkspaceRepository(
	_db: Database,
	_deps: RepositoryDeps,
): WorkspaceRepository {
	return {
		listAll: async () => notImplemented("DATA-01"),
		listByRepo: async () => notImplemented("DATA-01"),
		listByState: async () => notImplemented("DATA-01"),
		get: async () => notImplemented("DATA-01"),
		getByPath: async () => notImplemented("DATA-01"),
		getSetupLogPath: async () => notImplemented("DATA-01"),
		listDirectoryNames: async () => notImplemented("DATA-01"),
		listPorts: async () => notImplemented("DATA-01"),
		create: async () => notImplemented("DATA-01"),
		transitionState: async () => notImplemented("DATA-01"),
		markArchived: async () => notImplemented("DATA-01"),
		setKanbanStatus: async () => notImplemented("DATA-01"),
		setDisplayName: async () => notImplemented("DATA-01"),
		setBranch: async () => notImplemented("DATA-01"),
		setTargetBranch: async () => notImplemented("DATA-01"),
		setPinned: async () => notImplemented("DATA-01"),
		setNotes: async () => notImplemented("DATA-01"),
		setLinkedPaths: async () => notImplemented("DATA-01"),
		setPullRequest: async () => notImplemented("DATA-01"),
		clearPullRequest: async () => notImplemented("DATA-01"),
		setSetupLogPath: async () => notImplemented("DATA-01"),
		setActiveSession: async () => notImplemented("NAV-02"),
		setFilesCopied: async () => notImplemented("WS-03"),
		touchActivity: async () => notImplemented("DATA-01"),
		delete: async () => notImplemented("DATA-01"),
	};
}
