// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import {
	type ProviderKey,
	type ProviderKeyRow,
	providerKeyFromRow,
	providerKeyToParams,
} from "./provider-keys.ts";
import { createRepositories, type Repositories } from "./repositories.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;
let now: number;
let nextId: number;

beforeEach(() => {
	store = openTestDatabase();
	now = 1000;
	nextId = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => now },
		ids: { uuid: () => `generated-${++nextId}` },
	});
});

afterEach(() => {
	store.close();
});

const rowFromParams = (params: readonly unknown[]): ProviderKeyRow => ({
	agent: params[0] as ProviderKeyRow["agent"],
	acp_agent: params[1] as ProviderKeyRow["acp_agent"],
	provider: params[2] as string,
	env_var: params[3] as string,
	source: params[4] as ProviderKeyRow["source"],
	keychain_ref: params[5] as string | null,
	updated_at: params[6] as number,
});

describe("DATA-08 provider key mapping", () => {
	it("turns a null acpAgent into an empty string and turns it back", () => {
		const key: ProviderKey = {
			agent: "claude",
			acpAgent: null,
			provider: "anthropic",
			envVar: "ANTHROPIC_API_KEY",
			source: "entered",
			keychainRef: "keychain-1",
			updatedAt: 5,
		};
		const params = must(providerKeyToParams(key));
		expect(params[1]).toBe("");
		expect(providerKeyFromRow(rowFromParams(params))).toEqual(key);
	});

	it("keeps an ACP agent name as given", () => {
		const key: ProviderKey = {
			agent: "acp",
			acpAgent: "opencode",
			provider: "openrouter",
			envVar: "OPENROUTER_API_KEY",
			source: "this_mac",
			keychainRef: null,
			updatedAt: 6,
		};
		const params = must(providerKeyToParams(key));
		expect(params[1]).toBe("opencode");
		expect(providerKeyFromRow(rowFromParams(params))).toEqual(key);
	});

	it("requires a Keychain reference exactly when the source is entered", () => {
		const base: ProviderKey = {
			agent: "codex",
			acpAgent: null,
			provider: "openai",
			envVar: "OPENAI_API_KEY",
			source: "this_mac",
			keychainRef: null,
			updatedAt: 1,
		};
		expect(providerKeyToParams({ ...base, source: "entered", keychainRef: null })).toMatchObject({
			ok: false,
			error: { code: "db.invalid_row" },
		});
		expect(providerKeyToParams({ ...base, keychainRef: "keychain-1" })).toMatchObject({
			ok: false,
			error: { code: "db.invalid_row" },
		});
	});
});

describe("DATA-08 provider keys repository", () => {
	it("sets, lists and reads an entered key, leaving one row on a repeat", async () => {
		const name = {
			agent: "claude",
			acpAgent: null,
			provider: "anthropic",
			envVar: "ANTHROPIC_API_KEY",
		} as const;
		now = 2000;
		must(
			await repositories.providerKeys.set(name, {
				source: "entered",
				keychainRef: "keychain-1",
			}),
		);
		expect(must(await repositories.providerKeys.get(name))).toEqual({
			...name,
			source: "entered",
			keychainRef: "keychain-1",
			updatedAt: 2000,
		});
		expect(must(await repositories.providerKeys.listForAgent("claude", null))).toHaveLength(1);
		expect(must(await repositories.providerKeys.listForAgent("codex", null))).toHaveLength(0);

		now = 3000;
		must(
			await repositories.providerKeys.set(name, {
				source: "entered",
				keychainRef: "keychain-2",
			}),
		);
		const listed = must(await repositories.providerKeys.listForAgent("claude", null));
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({ keychainRef: "keychain-2", updatedAt: 3000 });
	});

	it("keeps a this_mac key without a Keychain reference", async () => {
		const name = {
			agent: "acp",
			acpAgent: "opencode",
			provider: "openrouter",
			envVar: "OPENROUTER_API_KEY",
		} as const;
		must(await repositories.providerKeys.set(name, { source: "this_mac" }));
		expect(must(await repositories.providerKeys.get(name))).toMatchObject({
			acpAgent: "opencode",
			source: "this_mac",
			keychainRef: null,
		});
		expect(must(await repositories.providerKeys.listForAgent("acp", "opencode"))).toHaveLength(1);
		expect(must(await repositories.providerKeys.listForAgent("acp", null))).toHaveLength(0);
	});

	it("removes a key and reports a missing one as null", async () => {
		const name = {
			agent: "cursor",
			acpAgent: null,
			provider: "cursor",
			envVar: "CURSOR_API_KEY",
		} as const;
		expect(must(await repositories.providerKeys.get(name))).toBeNull();
		must(await repositories.providerKeys.set(name, { source: "this_mac" }));
		must(await repositories.providerKeys.delete(name));
		expect(must(await repositories.providerKeys.get(name))).toBeNull();
		expect(must(await repositories.providerKeys.listForAgent("cursor", null))).toHaveLength(0);
	});
});
