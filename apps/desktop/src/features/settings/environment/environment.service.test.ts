import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedRepo, type TestContainer } from "../../../test/container.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

const container = (): TestContainer => {
	test = createTestContainer();
	return test;
};

describe("SET-04 environment service", () => {
	it("keeps the name in the table and the value in the Keychain, then removes both", async () => {
		const current = container();
		const settings = current.container.services.settings;

		const saved = await settings.setEnvVar("TOKEN", "abc", "global");
		expect(saved.ok).toBe(true);

		expect(await current.memory.platform.keychain.get("env:global:TOKEN")).toEqual({
			ok: true,
			value: "abc",
		});
		const listed = await settings.loadEnvVars("global");
		expect(listed.ok).toBe(true);
		expect(settings.store.getState().envVars?.global).toEqual({
			state: "ready",
			data: [
				{
					name: "TOKEN",
					scope: "global",
					hasValue: true,
					overridesGlobal: false,
					overriddenInRepos: 0,
				},
			],
		});

		expect((await settings.removeEnvVar("TOKEN", "global")).ok).toBe(true);
		expect(await current.memory.platform.keychain.get("env:global:TOKEN")).toEqual({
			ok: true,
			value: null,
		});
	});

	it("refuses a name the app sets itself and stores nothing", async () => {
		const current = container();
		const result = await current.container.services.settings.setEnvVar(
			"CONDUCTED_PORT",
			"1",
			"global",
		);

		expect(result.ok).toBe(false);
		expect(await current.memory.platform.keychain.get("env:global:CONDUCTED_PORT")).toEqual({
			ok: true,
			value: null,
		});
	});

	it("reveals a stored value and answers null when no value is stored", async () => {
		const current = container();
		const settings = current.container.services.settings;
		expect((await settings.setEnvVar("TOKEN", "abc", "global")).ok).toBe(true);

		expect(await settings.revealEnvVar("TOKEN", "global")).toEqual({ ok: true, value: "abc" });
		expect(await settings.revealEnvVar("MISSING", "global")).toEqual({ ok: true, value: null });
	});

	it("lets a repository value replace the global one and marks the override", async () => {
		const current = container();
		const repo = await seedRepo(current.container);
		const settings = current.container.services.settings;
		expect((await settings.setEnvVar("TOKEN", "global", "global")).ok).toBe(true);
		expect((await settings.setEnvVar("TOKEN", "repo", { repoId: repo.id })).ok).toBe(true);

		const environment = await settings.environmentFor(repo.id);
		expect(environment).toEqual({ ok: true, value: { TOKEN: "repo" } });

		await settings.loadEnvVars({ repoId: repo.id });
		expect(settings.store.getState().envVars?.[`repo:${repo.id}`]).toMatchObject({
			state: "ready",
			data: [{ name: "TOKEN", overridesGlobal: true }],
		});
	});

	it("lets only the newest read of a scope change the store", async () => {
		const current = container();
		const settings = current.container.services.settings;
		expect((await settings.setEnvVar("FIRST", "1", "global")).ok).toBe(true);

		const keychain = current.memory.platform.keychain;
		const original = keychain.get.bind(keychain);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const spy = vi.spyOn(keychain, "get").mockImplementation(async (key) => {
			calls += 1;
			if (calls === 1) await gate;
			return original(key);
		});

		try {
			const older = settings.loadEnvVars("global");
			expect((await settings.setEnvVar("SECOND", "2", "global")).ok).toBe(true);
			release();
			await older;

			const state = settings.store.getState().envVars?.global;
			expect(state?.state).toBe("ready");
			if (state?.state === "ready") {
				expect(state.data.map((row) => row.name).sort()).toEqual(["FIRST", "SECOND"]);
			}
		} finally {
			spy.mockRestore();
		}
	});
});
