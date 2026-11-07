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
	"app.resource-usage": `${NEEDS_RUST}: reads the process table (resource_usage.rs tests own it)`,
	"updater.check": `${NEEDS_RUST}: reads the release feed (updater.rs tests own it)`,
	"updater.installed-update": `${NEEDS_RUST}: reads the installed update record (updater.rs tests own it)`,
	"cloud.request-scripted": `${NEEDS_RUST}: needs a deployed Worker (CLOUD-03's Worker tests own the routes)`,
	"cloud.relay": `${NEEDS_RUST}: needs a deployed Worker (CLOUD-03's Worker tests own the relay)`,
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
			return {
				platform: created.value,
				root: run.root,
				outside: run.outside,
				controls: run.controls,
				cleanup,
			};
		} catch (error) {
			await cleanup();
			throw error;
		}
	},
	{ controls: true, skips: TAURI_SKIPS },
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
});
