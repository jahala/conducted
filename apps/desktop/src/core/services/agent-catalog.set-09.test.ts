import { randomUUID } from "node:crypto";
import { ok, type Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import type { ProviderKeyRef } from "../api.ts";
import type { ProviderKey } from "../db/provider-keys.ts";
import { createRepositories } from "../db/repositories.ts";
import { AgentCatalogService, providerKeychainRef } from "./agent-catalog.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

const key: ProviderKeyRef = {
	agent: "claude",
	acpAgent: null,
	provider: "anthropic",
	envVar: "ANTHROPIC_API_KEY",
};

const repositoryOf = (current: TestContainer) =>
	createRepositories(current.database, {
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => randomUUID() },
	});

const started = (): TestContainer => {
	test = createTestContainer();
	return test;
};

describe("SET-09 provider keys through the real container", () => {
	it("saves an entered key to the Keychain and its row, then removes both", async () => {
		const current = started();
		const service = current.container.services.agentCatalog;
		const repositories = repositoryOf(current);

		expect(await service.setProviderKey(key, { kind: "entered", value: "sk-ant-secret" })).toEqual(
			ok(undefined),
		);

		expect(await current.memory.platform.keychain.get(providerKeychainRef(key))).toEqual(
			ok("sk-ant-secret"),
		);
		expect(
			await repositories.providerKeys.get({
				agent: "claude",
				acpAgent: null,
				provider: "anthropic",
				envVar: "ANTHROPIC_API_KEY",
			}),
		).toMatchObject({
			ok: true,
			value: {
				source: "entered",
				keychainRef: providerKeychainRef(key),
			},
		});
		expect(service.store.getState().providerKeys?.claude).toEqual({
			state: "ready",
			data: [
				{
					agent: "claude",
					acpAgent: null,
					provider: "anthropic",
					envVar: "ANTHROPIC_API_KEY",
					source: "entered",
				},
			],
		});

		expect(await service.removeProviderKey(key)).toEqual(ok(undefined));

		expect(await current.memory.platform.keychain.get(providerKeychainRef(key))).toEqual(ok(null));
		expect(
			await repositories.providerKeys.get({
				agent: "claude",
				acpAgent: null,
				provider: "anthropic",
				envVar: "ANTHROPIC_API_KEY",
			}),
		).toEqual(ok(null));
		expect(service.store.getState().providerKeys?.claude).toEqual({
			state: "ready",
			data: [],
		});
	});

	it("stores the choice to use this Mac's key and deletes the earlier Keychain value", async () => {
		const current = started();
		const service = current.container.services.agentCatalog;
		const repositories = repositoryOf(current);
		await service.setProviderKey(key, { kind: "entered", value: "sk-ant-secret" });

		expect(await service.setProviderKey(key, { kind: "this_mac" })).toEqual(ok(undefined));

		expect(await current.memory.platform.keychain.get(providerKeychainRef(key))).toEqual(ok(null));
		expect(
			await repositories.providerKeys.get({
				agent: "claude",
				acpAgent: null,
				provider: "anthropic",
				envVar: "ANTHROPIC_API_KEY",
			}),
		).toMatchObject({ ok: true, value: { source: "this_mac", keychainRef: null } });
		expect(service.store.getState().providerKeys?.claude).toEqual({
			state: "ready",
			data: [
				{
					agent: "claude",
					acpAgent: null,
					provider: "anthropic",
					envVar: "ANTHROPIC_API_KEY",
					source: "this_mac",
				},
			],
		});
	});
});

describe("SET-09 provider key lists", () => {
	it("keeps the newer list when two loads for one agent answer out of order", async () => {
		const current = started();
		const repository = repositoryOf(current).providerKeys;
		const pending: ((value: Result<ProviderKey[]>) => void)[] = [];
		const listed = vi.spyOn(repository, "listForAgent").mockImplementation(
			() =>
				new Promise<Result<ProviderKey[]>>((resolve) => {
					pending.push(resolve);
				}),
		);
		const service = new AgentCatalogService({
			sidecar: { request: vi.fn() },
			launchFor: async () => ok({ env: {}, providerKeys: {} }),
			workspacePathOf: async () => ok("/workspace"),
			repoRootPathOf: async () => ok("/repo"),
			providerKeys: repository,
			keychain: current.memory.platform.keychain,
		});
		const older: ProviderKey = {
			agent: "claude",
			acpAgent: null,
			provider: "anthropic",
			envVar: "ANTHROPIC_API_KEY",
			source: "entered",
			keychainRef: "older",
			updatedAt: 1,
		};
		const newer: ProviderKey = { ...older, keychainRef: "newer", updatedAt: 2 };

		const first = service.loadProviderKeys("claude");
		const second = service.loadProviderKeys("claude");
		expect(listed).toHaveBeenCalledTimes(2);

		pending[1]?.(ok([newer]));
		await second;
		pending[0]?.(ok([older]));
		await first;

		expect(service.store.getState().providerKeys?.claude).toEqual({
			state: "ready",
			data: [
				{
					agent: "claude",
					acpAgent: null,
					provider: "anthropic",
					envVar: "ANTHROPIC_API_KEY",
					source: "entered",
				},
			],
		});
		expect(pending).toHaveLength(2);
	});
});
