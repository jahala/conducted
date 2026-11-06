/**
 * @feature SET-12 Claude settings and Codex config editors
 * Owns: tests for reading and saving the two agent config files.
 * Behaviour: ui-map.md 6, "Agents page" (the Claude settings JSON and Codex config editors).
 * Must handle: a missing file, a file that changed on disk, and two reads whose answers arrive out
 * of order.
 * Test first: a save with an outdated modifiedAt is refused and leaves the file alone.
 */
import { ok, type Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";

let test: TestContainer | undefined;

afterEach(() => {
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
});

const claudeFile = (current: TestContainer): string =>
	`${current.memory.platform.fs.paths.home}/.claude/settings.json`;
const codexFile = (current: TestContainer): string =>
	`${current.memory.platform.fs.paths.home}/.codex/config.toml`;

describe("SET-12 agent config files", () => {
	it("reads Claude's settings file, and reports a missing one without inventing text", async () => {
		test = createTestContainer();
		const catalog = test.container.services.agentCatalog;
		const path = claudeFile(test);

		const missing = await catalog.loadConfigFile("claude");
		expect(missing).toEqual(
			ok({ agent: "claude", path, text: "", exists: false, modifiedAt: null }),
		);
		expect(catalog.store.getState().configFiles?.claude).toEqual({
			state: "ready",
			data: { agent: "claude", path, text: "", exists: false, modifiedAt: null },
		});

		expect(await test.memory.platform.fs.writeTextAtomic(path, '{"model":"opus"}')).toEqual(
			ok(undefined),
		);
		const loaded = await catalog.loadConfigFile("claude");
		if (!loaded.ok) throw new Error(loaded.error.message);
		expect(loaded.value.exists).toBe(true);
		expect(loaded.value.text).toBe('{"model":"opus"}');
		expect(loaded.value.modifiedAt).toBeTypeOf("number");
	});

	it("creates Codex's config folder and writes the config file it reads back", async () => {
		test = createTestContainer({ enforceFileScope: true });
		const catalog = test.container.services.agentCatalog;
		const path = codexFile(test);

		expect(await test.memory.platform.fs.exists(path)).toBe(false);
		expect(await catalog.saveConfigFile("codex", 'model = "gpt-5"\n', null)).toEqual(ok(undefined));
		expect(await test.memory.platform.fs.readText(path)).toEqual(ok('model = "gpt-5"\n'));

		const loaded = await catalog.loadConfigFile("codex");
		if (!loaded.ok) throw new Error(loaded.error.message);
		expect(loaded.value).toMatchObject({
			agent: "codex",
			path,
			text: 'model = "gpt-5"\n',
			exists: true,
		});
	});

	it("refuses a save when the file changed since it was read", async () => {
		test = createTestContainer();
		const catalog = test.container.services.agentCatalog;
		const path = claudeFile(test);
		expect(await test.memory.platform.fs.writeTextAtomic(path, '{"model":"opus"}')).toEqual(
			ok(undefined),
		);
		const loaded = await catalog.loadConfigFile("claude");
		if (!loaded.ok || loaded.value.modifiedAt === null) throw new Error("no config file loaded");

		const saved = await catalog.saveConfigFile(
			"claude",
			'{"model":"sonnet"}',
			loaded.value.modifiedAt + 1,
		);
		expect(saved.ok).toBe(false);
		if (!saved.ok) expect(saved.error.code).toBe("changed_on_disk");
		expect(await test.memory.platform.fs.readText(path)).toEqual(ok('{"model":"opus"}'));
	});

	it("keeps the newer config read when two answer out of order", async () => {
		test = createTestContainer();
		const fs = test.memory.platform.fs;
		const path = claudeFile(test);
		expect(await fs.writeTextAtomic(path, "old")).toEqual(ok(undefined));

		const reads: ((value: Result<string>) => void)[] = [];
		vi.spyOn(fs, "readText").mockImplementation(
			() => new Promise<Result<string>>((resolve) => reads.push(resolve)),
		);
		const catalog = test.container.services.agentCatalog;

		const first = catalog.loadConfigFile("claude");
		const second = catalog.loadConfigFile("claude");
		await vi.waitFor(() => expect(reads).toHaveLength(2));

		reads[1]?.(ok("newer"));
		await second;
		reads[0]?.(ok("older"));
		await first;

		const state = catalog.store.getState().configFiles?.claude;
		expect(state?.state).toBe("ready");
		if (state?.state === "ready") expect(state.data.text).toBe("newer");
	});
});
