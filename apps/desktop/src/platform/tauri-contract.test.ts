// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { vitestContractHarness } from "../test/contract-harness.ts";
import { memoryPlatformForShape, platformMethods } from "../test/memory-platform.ts";
import { PLATFORM_CONTRACT_CASES, runPlatformContract } from "../test/platform-contract.ts";
import { createNodeTauriBindings } from "../test/tauri-node-bindings.ts";
import { createTauriPlatform } from "./tauri.ts";

const NEEDS_RUST = "Rust does this (the Node bindings cannot do it honestly)";

/** Cases the Node-backed run cannot run, each with the reason. Nothing else is skipped. */
const TAURI_SKIPS: Readonly<Record<string, string>> = {
	"fs.trash": `${NEEDS_RUST}: moves to the macOS Trash`,
	"fileSearch.list-tree-ignores": `${NEEDS_RUST}: the ignore crate`,
	"fileSearch.fuzzy": `${NEEDS_RUST}: file_search.rs`,
	"fileSearch.grep-bad-regex": `${NEEDS_RUST}: the regex crate's error text`,
	"fileSearch.list-artifacts": `${NEEDS_RUST}: file_search.rs`,
	"fileSearch.list-artifacts-files-only": `${NEEDS_RUST}: file_search.rs`,
	"fileSearch.list-artifacts-exclusions": `${NEEDS_RUST}: file_search.rs`,
	"fileSearch.list-artifacts-omitted": `${NEEDS_RUST}: file_search.rs`,
	"pty.spawn-echo": `${NEEDS_RUST}: a real pseudo-terminal`,
	"pty.exit-code": `${NEEDS_RUST}: a real pseudo-terminal`,
	"pty.screen-text": `${NEEDS_RUST}: a real pseudo-terminal`,
	"pty.kill": `${NEEDS_RUST}: a real pseudo-terminal`,
	"keychain.roundtrip": `${NEEDS_RUST}: the macOS Keychain`,
	"opener.installed-apps": `${NEEDS_RUST}: lists /Applications`,
	"speech.available": `${NEEDS_RUST}: Apple dictation over a real speech recognizer`,
	"speech.stop-ends": `${NEEDS_RUST}: Apple dictation over a real speech recognizer`,
	"system.info": `${NEEDS_RUST}: the macOS version and CPU`,
};

/**
 * Cases whose method is still a placeholder in the Tauri adapter, because the feature that builds
 * it is not done. They are skipped, not marked as failing (D055). The test below checks that each
 * method still throws for its feature, so the day a feature lands, that test fails and its entry
 * must come off this list. `pnpm stubs` already fails a done feature that keeps a placeholder.
 */
const NOT_BUILT: Readonly<Record<string, { feature: string; method: string }>> = {
	"updater.check": { feature: "PLAT-13", method: "updater.check" },
	"updater.installed-update": { feature: "PLAT-13", method: "updater.installedUpdate" },
	"system.full-disk-access": { feature: "PLAT-24", method: "system.hasFullDiskAccess" },
};

const TAURI_RUN_SKIPS: Readonly<Record<string, string>> = {
	...TAURI_SKIPS,
	...Object.fromEntries(
		Object.entries(NOT_BUILT).map(([id, { feature, method }]) => [
			id,
			`not built: ${feature} (${method} is a placeholder in tauri.ts)`,
		]),
	),
};

runPlatformContract(
	vitestContractHarness,
	"tauri",
	async () => {
		const dir = mkdtempSync(join(tmpdir(), "conducted-contract-"));
		const run = createNodeTauriBindings(dir);
		const cleanup = async (): Promise<void> => {
			await run.dispose();
			rmSync(dir, { recursive: true, force: true });
		};
		try {
			mkdirSync(run.root, { recursive: true });
			const created = await createTauriPlatform(run.bindings);
			if (!created.ok) throw new Error(`createTauriPlatform failed: ${created.error.message}`);
			return { platform: created.value, root: run.root, controls: run.controls, cleanup };
		} catch (error) {
			await cleanup();
			throw error;
		}
	},
	{ controls: true, skips: TAURI_RUN_SKIPS },
);

describe("PLAT-02 Tauri platform contract run", () => {
	it(`skips ${Object.keys(TAURI_SKIPS).length} of ${PLATFORM_CONTRACT_CASES.length} cases, all with a reason`, () => {
		const ids = new Set(PLATFORM_CONTRACT_CASES.map((testCase) => testCase.id));
		for (const [id, reason] of Object.entries(TAURI_SKIPS)) {
			expect(ids.has(id), `${id} is not a case`).toBe(true);
			expect(reason.length).toBeGreaterThan(0);
		}
	});

	it("builds the same methods in every group as the in-memory stand-in", async () => {
		const dir = mkdtempSync(join(tmpdir(), "conducted-contract-"));
		const run = createNodeTauriBindings(dir);
		try {
			const tauri = await createTauriPlatform(run.bindings);
			if (!tauri.ok) throw new Error(tauri.error.message);
			const memory = memoryPlatformForShape();
			expect(platformMethods(tauri.value).sort()).toEqual(platformMethods(memory).sort());
		} finally {
			await run.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips a not-built case only while its method is still a placeholder", async () => {
		const dir = mkdtempSync(join(tmpdir(), "conducted-contract-"));
		const run = createNodeTauriBindings(dir);
		try {
			const tauri = await createTauriPlatform(run.bindings);
			if (!tauri.ok) throw new Error(tauri.error.message);
			const ids = new Set(PLATFORM_CONTRACT_CASES.map((testCase) => testCase.id));
			expect(Object.keys(NOT_BUILT).length).toBeGreaterThan(0);
			for (const [id, { feature, method }] of Object.entries(NOT_BUILT)) {
				expect(ids.has(id), `${id} is not a case`).toBe(true);
				const [group, name] = method.split(".") as [string, string];
				const member = (tauri.value as unknown as Record<string, Record<string, unknown>>)[group]?.[
					name
				];
				expect(typeof member, `${method} exists on the Tauri platform`).toBe("function");
				const call = (member as () => unknown).bind(
					(tauri.value as unknown as Record<string, object>)[group],
				);
				await expect(
					Promise.resolve().then(call),
					`${method} is built now: take ${id} off NOT_BUILT`,
				).rejects.toThrow(feature);
			}
		} finally {
			await run.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
