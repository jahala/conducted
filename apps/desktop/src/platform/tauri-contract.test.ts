// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { vitestContractHarness } from "../test/contract-harness.ts";
import { createNodeTauriBindings } from "../test/tauri-node-bindings.ts";
import { PLATFORM_CONTRACT_CASES, runPlatformContract } from "./contract.ts";
import { createMemoryPlatform } from "./memory.ts";
import type { Database, Platform } from "./platform.ts";
import { createTauriPlatform } from "./tauri.ts";

const NEEDS_RUST = "Rust does this (the Node bindings cannot do it honestly)";

/** Cases the Node-backed run cannot run, each with the reason. Nothing else is skipped. */
const TAURI_SKIPS: Readonly<Record<string, string>> = {
	"fs.trash": `${NEEDS_RUST}: moves to the macOS Trash`,
	"fileSearch.list-tree-ignores": `${NEEDS_RUST}: the ignore crate`,
	"fileSearch.fuzzy": `${NEEDS_RUST}: file_search.rs`,
	"fileSearch.grep-bad-regex": `${NEEDS_RUST}: the regex crate's error text`,
	"pty.spawn-echo": `${NEEDS_RUST}: a real pseudo-terminal`,
	"pty.exit-code": `${NEEDS_RUST}: a real pseudo-terminal`,
	"pty.screen-text": `${NEEDS_RUST}: a real pseudo-terminal`,
	"pty.kill": `${NEEDS_RUST}: a real pseudo-terminal`,
	"keychain.roundtrip": `${NEEDS_RUST}: the macOS Keychain`,
	"opener.installed-apps": `${NEEDS_RUST}: lists /Applications`,
	"speech.available": `${NEEDS_RUST}: Apple dictation, and the adapter is a placeholder (PLAT-12)`,
	"speech.stop-ends": `${NEEDS_RUST}: Apple dictation, and the adapter is a placeholder (PLAT-12)`,
	"window.setters": `${NEEDS_RUST}: a real window, and the adapter is a placeholder (PLAT-23)`,
	"system.info": `${NEEDS_RUST}: the macOS version and CPU`,
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
	{ controls: true, skips: TAURI_SKIPS },
);

const unusedDatabase: Database = {
	execute: () => Promise.reject(new Error("The shape check does not use the database.")),
	select: () => Promise.reject(new Error("The shape check does not use the database.")),
	transaction: () => Promise.reject(new Error("The shape check does not use the database.")),
};

const methodsOf = (platform: Platform): string[] =>
	Object.entries(platform).flatMap(([group, value]) =>
		Object.entries(value as object)
			.filter(([, member]) => typeof member === "function")
			.map(([name]) => `${group}.${name}`),
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
			let counter = 0;
			const memory = createMemoryPlatform({
				clock: { now: () => 0 },
				ids: { uuid: () => `id-${++counter}` },
				database: unusedDatabase,
			}).platform;
			expect(methodsOf(tauri.value).sort()).toEqual(methodsOf(memory).sort());
		} finally {
			await run.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
