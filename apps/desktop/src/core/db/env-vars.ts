/**
 * @feature DATA-01 Repository for the env_vars table
 * Owns: the names and scopes of environment variables. Values live in the macOS Keychain; this
 * table holds only the keychain reference.
 * Behaviour: services-map.md 2.3.5 (env_vars: set, tombstone, delete; upsert on name, scope,
 * context). Our design choice: no tombstones, a delete removes the row.
 * Must handle: the primary key (name, scope, repo_id) does not stop duplicate global rows,
 * because SQLite treats NULL repo_id values as different from each other. So an upsert is an
 * UPDATE followed by an INSERT that runs only when no row matches (`repo_id IS $3` compares
 * NULLs correctly), in one transaction; a repo-scoped row needs a repo id and a global row must
 * not have one; deleting a repo cascades to its rows.
 * Test first: setting the same global name twice leaves one row.
 */
import { appError, err, notImplemented, ok, type RepoId, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { RepositoryDeps } from "./deps.ts";

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

export function createEnvVarRepository(_db: Database, _deps: RepositoryDeps): EnvVarRepository {
	return {
		listGlobal: async () => notImplemented("DATA-01"),
		listByRepo: async () => notImplemented("DATA-01"),
		listForRepo: async () => notImplemented("DATA-01"),
		get: async () => notImplemented("DATA-01"),
		set: async () => notImplemented("DATA-01"),
		delete: async () => notImplemented("DATA-01"),
	};
}
