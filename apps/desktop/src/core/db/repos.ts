/**
 * @feature DATA-01 Repository for the repos table
 * Owns: every read and write of the repos table (git repositories the user added).
 * Behaviour: services-map.md 2.3.2 (repos). Our table is smaller: no scripts or prompts, those
 * live in the repo config files.
 * Must handle: a duplicate root_path (UNIQUE) returns an error Result instead of throwing;
 * deleting a repo cascades to its workspaces, sessions, comments, terminals and env vars; the
 * next display_order is read and inserted in one transaction so two adds never share a slot.
 * Test first: repoToParams then repoFromRow gives back the same Repo, including hidden=true.
 */
import { err, ok, type RepoId, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Repo } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	executeStatement,
	executeVoid,
	fromFlag,
	inTransaction,
	selectRows,
	toFlag,
} from "./row-codec.ts";

export interface RepoRow {
	id: RepoId;
	name: string;
	root_path: string;
	remote_url: string | null;
	default_branch: string;
	icon: string | null;
	display_order: number;
	hidden: number;
	created_at: number;
	updated_at: number;
}

export const repoFromRow = (row: RepoRow): Repo => ({
	id: row.id,
	name: row.name,
	rootPath: row.root_path,
	remoteUrl: row.remote_url,
	defaultBranch: row.default_branch,
	icon: row.icon,
	displayOrder: row.display_order,
	hidden: fromFlag(row.hidden),
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

/** Parameters for REPOS_SQL.insert, in column order. */
export const repoToParams = (repo: Repo): readonly unknown[] => [
	repo.id,
	repo.name,
	repo.rootPath,
	repo.remoteUrl,
	repo.defaultBranch,
	repo.icon,
	repo.displayOrder,
	toFlag(repo.hidden),
	repo.createdAt,
	repo.updatedAt,
];

const COLUMNS =
	"id, name, root_path, remote_url, default_branch, icon, display_order, hidden, created_at, updated_at";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const REPOS_SQL = {
	list: `SELECT ${COLUMNS} FROM repos ORDER BY display_order, name, id`,
	listVisible: `SELECT ${COLUMNS} FROM repos WHERE hidden = 0 ORDER BY display_order, name, id`,
	get: `SELECT ${COLUMNS} FROM repos WHERE id = $1`,
	getByRootPath: `SELECT ${COLUMNS} FROM repos WHERE root_path = $1`,
	nextDisplayOrder: "SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM repos",
	insert: `INSERT INTO repos (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
	setName: "UPDATE repos SET name = $1, updated_at = $2 WHERE id = $3",
	setDefaultBranch: "UPDATE repos SET default_branch = $1, updated_at = $2 WHERE id = $3",
	setRemoteUrl: "UPDATE repos SET remote_url = $1, updated_at = $2 WHERE id = $3",
	setIcon: "UPDATE repos SET icon = $1, updated_at = $2 WHERE id = $3",
	setHidden: "UPDATE repos SET hidden = $1, updated_at = $2 WHERE id = $3",
	setDisplayOrder: "UPDATE repos SET display_order = $1, updated_at = $2 WHERE id = $3",
	delete: "DELETE FROM repos WHERE id = $1",
} as const;

/** What a caller supplies to add a repo. The repository adds id, order and times. */
export type NewRepo = Pick<Repo, "name" | "rootPath" | "remoteUrl" | "defaultBranch" | "icon"> & {
	hidden?: boolean;
};

export interface RepoRepository {
	/** REPOS_SQL.list, or listVisible when `includeHidden` is false. Sorted by display order. */
	list(options: { includeHidden: boolean }): Promise<Result<Repo[]>>;
	/** REPOS_SQL.get. A missing repo is `ok(null)`. */
	get(id: RepoId): Promise<Result<Repo | null>>;
	/** REPOS_SQL.getByRootPath. Used to stop the user adding the same folder twice. */
	getByRootPath(rootPath: string): Promise<Result<Repo | null>>;
	/**
	 * REPOS_SQL.nextDisplayOrder then REPOS_SQL.insert, inside one transaction. A duplicate
	 * root_path returns the error code `db.conflict`.
	 */
	create(input: NewRepo): Promise<Result<Repo>>;
	/** REPOS_SQL.setName. Bumps updated_at. */
	setName(id: RepoId, name: string): Promise<Result<void>>;
	/** REPOS_SQL.setDefaultBranch. */
	setDefaultBranch(id: RepoId, branch: string): Promise<Result<void>>;
	/** REPOS_SQL.setRemoteUrl. `null` clears it. */
	setRemoteUrl(id: RepoId, url: string | null): Promise<Result<void>>;
	/** REPOS_SQL.setIcon. `null` clears it. */
	setIcon(id: RepoId, icon: string | null): Promise<Result<void>>;
	/** REPOS_SQL.setHidden. */
	setHidden(id: RepoId, hidden: boolean): Promise<Result<void>>;
	/** REPOS_SQL.setDisplayOrder for each id in the given order, in one transaction. */
	reorder(orderedIds: readonly RepoId[]): Promise<Result<void>>;
	/** REPOS_SQL.delete. The database cascades to everything the repo owns. */
	delete(id: RepoId): Promise<Result<void>>;
}

export function createRepoRepository(db: Database, deps: RepositoryDeps): RepoRepository {
	const now = (): number => deps.clock.now();
	return {
		list: async ({ includeHidden }) => {
			const rows = await selectRows<RepoRow>(
				db,
				includeHidden ? REPOS_SQL.list : REPOS_SQL.listVisible,
				[],
				"Listing repositories",
			);
			return rows.ok ? ok(rows.value.map(repoFromRow)) : err(rows.error);
		},
		get: async (id) => {
			const rows = await selectRows<RepoRow>(db, REPOS_SQL.get, [id], "Reading a repository");
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return ok(row === undefined ? null : repoFromRow(row));
		},
		getByRootPath: async (rootPath) => {
			const rows = await selectRows<RepoRow>(
				db,
				REPOS_SQL.getByRootPath,
				[rootPath],
				"Reading a repository by its folder",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return ok(row === undefined ? null : repoFromRow(row));
		},
		create: async (input) =>
			inTransaction(db, "Adding a repository", async (tx) => {
				const next = await selectRows<{ next: number }>(
					tx,
					REPOS_SQL.nextDisplayOrder,
					[],
					"Reading the next repository order",
				);
				if (!next.ok) return err(next.error);
				const at = now();
				const repo: Repo = {
					id: deps.ids.uuid() as RepoId,
					name: input.name,
					rootPath: input.rootPath,
					remoteUrl: input.remoteUrl,
					defaultBranch: input.defaultBranch,
					icon: input.icon,
					displayOrder: next.value[0]?.next ?? 0,
					hidden: input.hidden ?? false,
					createdAt: at,
					updatedAt: at,
				};
				const written = await executeStatement(
					tx,
					REPOS_SQL.insert,
					repoToParams(repo),
					"Adding a repository",
				);
				return written.ok ? ok(repo) : err(written.error);
			}),
		setName: async (id, name) =>
			executeVoid(db, REPOS_SQL.setName, [name, now(), id], "Renaming a repository"),
		setDefaultBranch: async (id, branch) =>
			executeVoid(
				db,
				REPOS_SQL.setDefaultBranch,
				[branch, now(), id],
				"Changing a repository branch",
			),
		setRemoteUrl: async (id, url) =>
			executeVoid(db, REPOS_SQL.setRemoteUrl, [url, now(), id], "Changing a repository remote"),
		setIcon: async (id, icon) =>
			executeVoid(db, REPOS_SQL.setIcon, [icon, now(), id], "Changing a repository icon"),
		setHidden: async (id, hidden) =>
			executeVoid(db, REPOS_SQL.setHidden, [toFlag(hidden), now(), id], "Hiding a repository"),
		reorder: async (orderedIds) =>
			inTransaction(db, "Reordering repositories", async (tx) => {
				const at = now();
				for (const [index, id] of orderedIds.entries()) {
					const written = await executeStatement(
						tx,
						REPOS_SQL.setDisplayOrder,
						[index, at, id],
						"Reordering repositories",
					);
					if (!written.ok) return err(written.error);
				}
				return ok(undefined);
			}),
		delete: async (id) => executeVoid(db, REPOS_SQL.delete, [id], "Removing a repository"),
	};
}
