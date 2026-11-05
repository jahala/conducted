/**
 * @feature DATA-01 Repository for the env_vars table
 * Owns: the names and scopes of environment variables. Values live in the macOS Keychain; this
 * table holds only the keychain reference.
 * Behaviour: services-map.md 2.3.5 (env_vars: set, tombstone, delete; upsert on name, scope,
 * context). Our design choice: no tombstones, a delete removes the row.
 * Must handle: the primary key (name, scope, repo_id) does not stop duplicate global rows,
 * because SQLite treats NULL repo_id values as different from each other (migration 0002 adds a
 * unique index on name, scope and repo_id that closes this at the database too). An upsert is an
 * UPDATE followed by an INSERT that runs only when no row matches (`repo_id IS ?` compares
 * NULLs correctly), in one transaction; a repo-scoped row needs a repo id and a global row must
 * not have one; deleting a repo cascades to its rows.
 * Test first: setting the same global name twice leaves one row.
 */
import { appError, err, ok, type RepoId, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";
import { executeStatement, executeVoid, inTransaction, selectRows } from "./row-codec.ts";

export interface EnvVarRow {
	name: string;
	scope: "global" | "repo";
	repo_id: RepoId | null;
	keychain_ref: string;
}

export interface EnvVar {
	name: string;
	scope: "global" | "repo";
	repoId: RepoId | null;
	/** Where the value is kept in the Keychain. */
	keychainRef: string;
}

export const envVarFromRow = (row: EnvVarRow): EnvVar => ({
	name: row.name,
	scope: row.scope,
	repoId: row.repo_id,
	keychainRef: row.keychain_ref,
});

/** Parameters for ENV_VARS_SQL.upsertInsert: name, scope, repo id, keychain reference. */
export function envVarToParams(envVar: EnvVar): Result<readonly unknown[]> {
	if (envVar.scope === "repo" && envVar.repoId === null) {
		return err(appError("db.invalid_row", `Env var ${envVar.name} is repo-scoped but has no repo`));
	}
	if (envVar.scope === "global" && envVar.repoId !== null) {
		return err(appError("db.invalid_row", `Env var ${envVar.name} is global but names a repo`));
	}
	return ok([envVar.name, envVar.scope, envVar.repoId, envVar.keychainRef]);
}

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const ENV_VARS_SQL = {
	listGlobal: `SELECT name, scope, repo_id, keychain_ref FROM env_vars WHERE scope = 'global'
		ORDER BY name`,
	listByRepo: `SELECT name, scope, repo_id, keychain_ref FROM env_vars
		WHERE scope = 'repo' AND repo_id = $1 ORDER BY name`,
	/** Global and repo rows together, for building the environment of one repo. */
	listForRepo: `SELECT name, scope, repo_id, keychain_ref FROM env_vars
		WHERE scope = 'global' OR repo_id = $1 ORDER BY name, scope`,
	get: `SELECT name, scope, repo_id, keychain_ref FROM env_vars
		WHERE name = $1 AND scope = $2 AND repo_id IS $3`,
	/** Step 1 of an upsert. Zero rows affected means step 2 has to insert. */
	upsertUpdate: `UPDATE env_vars SET keychain_ref = $1
		WHERE name = $2 AND scope = $3 AND repo_id IS $4`,
	/** Step 2 of an upsert. Inserts only when no row with this key exists. */
	upsertInsert: `INSERT INTO env_vars (name, scope, repo_id, keychain_ref)
		SELECT $1, $2, $3, $4
		WHERE NOT EXISTS (
			SELECT 1 FROM env_vars WHERE name = $1 AND scope = $2 AND repo_id IS $3)`,
	delete: "DELETE FROM env_vars WHERE name = $1 AND scope = $2 AND repo_id IS $3",
} as const;

export interface EnvVarRepository {
	/** ENV_VARS_SQL.listGlobal. */
	listGlobal(): Promise<Result<EnvVar[]>>;
	/** ENV_VARS_SQL.listByRepo: only the repo's own rows. */
	listByRepo(repoId: RepoId): Promise<Result<EnvVar[]>>;
	/** ENV_VARS_SQL.listForRepo: global rows and the repo's rows; the caller lets repo rows win. */
	listForRepo(repoId: RepoId): Promise<Result<EnvVar[]>>;
	/** ENV_VARS_SQL.get. A missing variable is `ok(null)`. */
	get(name: string, scope: EnvVar["scope"], repoId: RepoId | null): Promise<Result<EnvVar | null>>;
	/** ENV_VARS_SQL.upsertUpdate then ENV_VARS_SQL.upsertInsert, in one transaction. */
	set(envVar: EnvVar): Promise<Result<void>>;
	/** ENV_VARS_SQL.delete. The caller removes the Keychain entry. */
	delete(name: string, scope: EnvVar["scope"], repoId: RepoId | null): Promise<Result<void>>;
}

export function createEnvVarRepository(db: Database, _deps: RepositoryDeps): EnvVarRepository {
	const list = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<EnvVar[]>> => {
		const rows = await selectRows<EnvVarRow>(db, sql, params, what);
		return rows.ok ? ok(rows.value.map(envVarFromRow)) : err(rows.error);
	};
	return {
		listGlobal: () => list(ENV_VARS_SQL.listGlobal, [], "Listing global environment variables"),
		listByRepo: (repoId) =>
			list(ENV_VARS_SQL.listByRepo, [repoId], "Listing a repository's environment variables"),
		listForRepo: (repoId) =>
			list(ENV_VARS_SQL.listForRepo, [repoId], "Listing environment variables for a repository"),
		get: async (name, scope, repoId) => {
			const rows = await selectRows<EnvVarRow>(
				db,
				ENV_VARS_SQL.get,
				[name, scope, repoId],
				"Reading an environment variable",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : ok(envVarFromRow(row));
		},
		set: async (envVar) => {
			const params = envVarToParams(envVar);
			if (!params.ok) return err(params.error);
			return inTransaction(db, "Saving an environment variable", async (tx) => {
				const updated = await executeStatement(
					tx,
					ENV_VARS_SQL.upsertUpdate,
					[envVar.keychainRef, envVar.name, envVar.scope, envVar.repoId],
					"Saving an environment variable",
				);
				if (!updated.ok) return err(updated.error);
				if (updated.value > 0) return ok(undefined);
				const inserted = await executeStatement(
					tx,
					ENV_VARS_SQL.upsertInsert,
					params.value,
					"Saving an environment variable",
				);
				return inserted.ok ? ok(undefined) : err(inserted.error);
			});
		},
		delete: (name, scope, repoId) =>
			executeVoid(
				db,
				ENV_VARS_SQL.delete,
				[name, scope, repoId],
				"Removing an environment variable",
			),
	};
}
