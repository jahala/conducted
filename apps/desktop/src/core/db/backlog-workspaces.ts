/**
 * @feature DATA-08 Repository for the backlog_workspaces table
 * Owns: every read and write of workspaces saved to the backlog (the prompt and settings to start
 * one later, with no worktree, branch or port yet).
 * Behaviour: services-map.md 2.2 and 2.3 (workspaces with a backlog state); migration 0004. Our
 * design choice: a backlog entry is its own table, so `workspaces` never holds a row without a
 * folder. Starting an entry inserts the `workspaces` row with the same id and deletes the entry,
 * in one transaction owned by the workspace service (WS-11).
 * Must handle: a bad config or attachment list column returns an error Result; deleting a repo
 * cascades to its entries; deleting a section only clears `section_id`; every update sets
 * `updated_at`; ids and times come from `RepositoryDeps`.
 * Test first: backlogWorkspaceFromRow returns an error Result when config is not a valid
 * SessionConfig.
 */
import { zSessionConfig } from "@conducted/protocol";
import {
	notImplemented,
	type RepoId,
	type Result,
	type SectionId,
	type WorkspaceId,
} from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { BacklogWorkspace } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import { parseJsonColumn, parseStringList, stringifyJson } from "./row-codec.ts";

export interface BacklogWorkspaceRow {
	id: WorkspaceId;
	repo_id: RepoId;
	display_name: string | null;
	prompt: string;
	attachment_paths: string;
	config: string;
	section_id: SectionId | null;
	created_at: number;
	updated_at: number;
}

export function backlogWorkspaceFromRow(row: BacklogWorkspaceRow): Result<BacklogWorkspace> {
	const attachmentPaths = parseStringList(
		row.attachment_paths,
		"backlog_workspaces.attachment_paths",
	);
	if (!attachmentPaths.ok) return attachmentPaths;
	const config = parseJsonColumn(row.config, zSessionConfig, "backlog_workspaces.config");
	if (!config.ok) return config;
	return {
		ok: true,
		value: {
			id: row.id,
			repoId: row.repo_id,
			displayName: row.display_name,
			prompt: row.prompt,
			attachmentPaths: attachmentPaths.value,
			config: config.value,
			sectionId: row.section_id,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		},
	};
}

/** Parameters for BACKLOG_WORKSPACES_SQL.insert, in column order. */
export function backlogWorkspaceToParams(entry: BacklogWorkspace): Result<readonly unknown[]> {
	const attachmentPaths = stringifyJson(
		entry.attachmentPaths,
		"backlog_workspaces.attachment_paths",
	);
	if (!attachmentPaths.ok) return attachmentPaths;
	const config = stringifyJson(entry.config, "backlog_workspaces.config");
	if (!config.ok) return config;
	return {
		ok: true,
		value: [
			entry.id,
			entry.repoId,
			entry.displayName,
			entry.prompt,
			attachmentPaths.value,
			config.value,
			entry.sectionId,
			entry.createdAt,
			entry.updatedAt,
		],
	};
}

const COLUMNS =
	"id, repo_id, display_name, prompt, attachment_paths, config, section_id, created_at, updated_at";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const BACKLOG_WORKSPACES_SQL = {
	list: `SELECT ${COLUMNS} FROM backlog_workspaces ORDER BY created_at, id`,
	listByRepo: `SELECT ${COLUMNS} FROM backlog_workspaces WHERE repo_id = $1 ORDER BY created_at, id`,
	get: `SELECT ${COLUMNS} FROM backlog_workspaces WHERE id = $1`,
	insert: `INSERT INTO backlog_workspaces (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
	/** Rewrites what the user can edit on an entry: name, prompt, attachments, config, time, id. */
	update: `UPDATE backlog_workspaces
		SET display_name = $1, prompt = $2, attachment_paths = $3, config = $4, updated_at = $5
		WHERE id = $6`,
	setSection: "UPDATE backlog_workspaces SET section_id = $1, updated_at = $2 WHERE id = $3",
	delete: "DELETE FROM backlog_workspaces WHERE id = $1",
} as const;

/** What a caller supplies to save a workspace to the backlog. The repository adds id and times. */
export type NewBacklogWorkspace = Pick<
	BacklogWorkspace,
	"repoId" | "displayName" | "prompt" | "attachmentPaths" | "config" | "sectionId"
>;

/** What the user can change on a saved entry. */
export type BacklogWorkspacePatch = Pick<
	BacklogWorkspace,
	"displayName" | "prompt" | "attachmentPaths" | "config"
>;

export interface BacklogWorkspaceRepository {
	/** BACKLOG_WORKSPACES_SQL.list: every entry, oldest first. */
	list(): Promise<Result<BacklogWorkspace[]>>;
	/** BACKLOG_WORKSPACES_SQL.listByRepo. */
	listByRepo(repoId: RepoId): Promise<Result<BacklogWorkspace[]>>;
	/** BACKLOG_WORKSPACES_SQL.get. A missing entry is `ok(null)`. */
	get(id: WorkspaceId): Promise<Result<BacklogWorkspace | null>>;
	/** BACKLOG_WORKSPACES_SQL.insert with a new id and both times from the dependencies. */
	create(input: NewBacklogWorkspace): Promise<Result<BacklogWorkspace>>;
	/** BACKLOG_WORKSPACES_SQL.update. A missing entry returns the error code `db.not_found`. */
	update(id: WorkspaceId, patch: BacklogWorkspacePatch): Promise<Result<void>>;
	/** BACKLOG_WORKSPACES_SQL.setSection. `null` takes the entry out of its section. */
	setSection(id: WorkspaceId, sectionId: SectionId | null): Promise<Result<void>>;
	/** BACKLOG_WORKSPACES_SQL.delete. Runs when the entry starts or the user deletes it. */
	delete(id: WorkspaceId): Promise<Result<void>>;
}

export function createBacklogWorkspaceRepository(
	_db: Database,
	_deps: RepositoryDeps,
): BacklogWorkspaceRepository {
	return {
		list: async () => notImplemented("DATA-08"),
		listByRepo: async () => notImplemented("DATA-08"),
		get: async () => notImplemented("DATA-08"),
		create: async () => notImplemented("DATA-08"),
		update: async () => notImplemented("DATA-08"),
		setSection: async () => notImplemented("DATA-08"),
		delete: async () => notImplemented("DATA-08"),
	};
}
