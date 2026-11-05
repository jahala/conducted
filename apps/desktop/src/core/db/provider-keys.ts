/**
 * @feature DATA-08 Repository for the provider_keys table
 * Owns: where each provider key of an agent goes: the agent, the provider, the environment
 * variable and whether the value sits in the Keychain or is read from the Mac's environment. The
 * values themselves live in the macOS Keychain, never in this table.
 * Behaviour: migration 0004; services-map.md 2.3.5 (env_vars keep a Keychain reference, not the
 * value); decision D033 (each key reaches only its own agent).
 * Our design choice: `acp_agent` is '' in the table and null in the model, so the primary key
 * (agent, acp_agent, provider, env_var) has no NULL part.
 * Must handle: source 'entered' needs a Keychain reference and 'this_mac' must not have one (the
 * table checks it, and the mapper returns an error Result first); setting the same key twice
 * leaves one row; the repository never touches the Keychain, the caller removes that entry.
 * Test first: providerKeyToParams turns a null acpAgent into '', and providerKeyFromRow turns
 * it back.
 */
import { type AcpAgent, type AgentKind, appError, err, ok, type Result } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { ProviderKeyView } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import { executeVoid, selectRows } from "./row-codec.ts";

export interface ProviderKeyRow {
	agent: AgentKind;
	acp_agent: AcpAgent | "";
	provider: string;
	env_var: string;
	source: "entered" | "this_mac";
	keychain_ref: string | null;
	updated_at: number;
}

/** A stored provider key. `source` is never null here: a key with no row is not set. */
export interface ProviderKey extends Omit<ProviderKeyView, "source"> {
	source: "entered" | "this_mac";
	/** Where the value is kept in the Keychain. Null when `source` is 'this_mac'. */
	keychainRef: string | null;
	updatedAt: number;
}

/** Names one key: the primary key of the table. */
export type ProviderKeyName = Pick<ProviderKey, "agent" | "acpAgent" | "provider" | "envVar">;

export function providerKeyFromRow(row: ProviderKeyRow): ProviderKey {
	return {
		agent: row.agent,
		acpAgent: row.acp_agent === "" ? null : row.acp_agent,
		provider: row.provider,
		envVar: row.env_var,
		source: row.source,
		keychainRef: row.keychain_ref,
		updatedAt: row.updated_at,
	};
}

/** Parameters for PROVIDER_KEYS_SQL.upsert, in column order. */
export function providerKeyToParams(key: ProviderKey): Result<readonly unknown[]> {
	if ((key.source === "entered") !== (key.keychainRef !== null)) {
		return err(
			appError(
				"db.invalid_row",
				`Provider key ${key.envVar} must have a Keychain reference exactly when its source is entered`,
			),
		);
	}
	return ok([
		key.agent,
		key.acpAgent ?? "",
		key.provider,
		key.envVar,
		key.source,
		key.keychainRef,
		key.updatedAt,
	]);
}

const COLUMNS = "agent, acp_agent, provider, env_var, source, keychain_ref, updated_at";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const PROVIDER_KEYS_SQL = {
	list: `SELECT ${COLUMNS} FROM provider_keys ORDER BY agent, acp_agent, provider, env_var`,
	listForAgent: `SELECT ${COLUMNS} FROM provider_keys WHERE agent = $1 AND acp_agent = $2
		ORDER BY provider, env_var`,
	get: `SELECT ${COLUMNS} FROM provider_keys
		WHERE agent = $1 AND acp_agent = $2 AND provider = $3 AND env_var = $4`,
	upsert: `INSERT INTO provider_keys (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (agent, acp_agent, provider, env_var) DO UPDATE SET
			source = excluded.source, keychain_ref = excluded.keychain_ref,
			updated_at = excluded.updated_at`,
	delete: `DELETE FROM provider_keys
		WHERE agent = $1 AND acp_agent = $2 AND provider = $3 AND env_var = $4`,
} as const;

export interface ProviderKeyRepository {
	/** PROVIDER_KEYS_SQL.list. */
	list(): Promise<Result<ProviderKey[]>>;
	/** PROVIDER_KEYS_SQL.listForAgent. `acpAgent` null means an agent that is not an ACP agent. */
	listForAgent(agent: AgentKind, acpAgent: AcpAgent | null): Promise<Result<ProviderKey[]>>;
	/** PROVIDER_KEYS_SQL.get. A key that is not set is `ok(null)`. */
	get(name: ProviderKeyName): Promise<Result<ProviderKey | null>>;
	/** PROVIDER_KEYS_SQL.upsert, with `updatedAt` taken from the clock in the dependencies. */
	set(
		name: ProviderKeyName,
		value: { source: "entered"; keychainRef: string } | { source: "this_mac" },
	): Promise<Result<void>>;
	/** PROVIDER_KEYS_SQL.delete. The caller removes the Keychain entry. */
	delete(name: ProviderKeyName): Promise<Result<void>>;
}

export function createProviderKeyRepository(
	db: Database,
	deps: RepositoryDeps,
): ProviderKeyRepository {
	const now = (): number => deps.clock.now();
	const list = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<ProviderKey[]>> => {
		const rows = await selectRows<ProviderKeyRow>(db, sql, params, what);
		return rows.ok ? ok(rows.value.map(providerKeyFromRow)) : err(rows.error);
	};
	return {
		list: () => list(PROVIDER_KEYS_SQL.list, [], "Listing provider keys"),
		listForAgent: (agent, acpAgent) =>
			list(
				PROVIDER_KEYS_SQL.listForAgent,
				[agent, acpAgent ?? ""],
				"Listing an agent's provider keys",
			),
		get: async (name) => {
			const rows = await selectRows<ProviderKeyRow>(
				db,
				PROVIDER_KEYS_SQL.get,
				[name.agent, name.acpAgent ?? "", name.provider, name.envVar],
				"Reading a provider key",
			);
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return ok(row === undefined ? null : providerKeyFromRow(row));
		},
		set: async (name, value) => {
			const key: ProviderKey = {
				agent: name.agent,
				acpAgent: name.acpAgent,
				provider: name.provider,
				envVar: name.envVar,
				source: value.source,
				keychainRef: value.source === "entered" ? value.keychainRef : null,
				updatedAt: now(),
			};
			const params = providerKeyToParams(key);
			if (!params.ok) return err(params.error);
			return executeVoid(db, PROVIDER_KEYS_SQL.upsert, params.value, "Saving a provider key");
		},
		delete: (name) =>
			executeVoid(
				db,
				PROVIDER_KEYS_SQL.delete,
				[name.agent, name.acpAgent ?? "", name.provider, name.envVar],
				"Removing a provider key",
			),
	};
}
