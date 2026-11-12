// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { vitestContractHarness } from "../test/contract-harness.ts";
import { memoryPlatformForShape, platformMethods } from "../test/memory-platform.ts";
import { PLATFORM_CONTRACT_CASES, runPlatformContract } from "../test/platform-contract.ts";
import { createNodeTauriBindings } from "../test/tauri-node-bindings.ts";
import {
	CONDUCTOR_COPY_FOLDER,
	CONDUCTOR_COUNTED_TABLES,
	CONDUCTOR_READ_TABLES,
	PLATFORM_ERROR_CODES,
	VISUALIZATION_MAX_PAGES,
	VISUALIZATION_MAX_STORE_BYTES,
} from "./platform.ts";
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
	"opener.app-icon": `${NEEDS_RUST}: reads app bundles with plutil and sips (open_with.rs tests own it)`,
	"speech.available": `${NEEDS_RUST}: Apple dictation over a real speech recognizer`,
	"speech.stop-ends": `${NEEDS_RUST}: Apple dictation over a real speech recognizer`,
	"system.info": `${NEEDS_RUST}: the macOS version and CPU`,
	"app.resource-usage": `${NEEDS_RUST}: reads the process table (resource_usage.rs tests own it)`,
	"updater.check": `${NEEDS_RUST}: reads the release feed (updater.rs tests own it)`,
	"updater.installed-update": `${NEEDS_RUST}: reads the installed update record (updater.rs tests own it)`,
	"cloud.request-scripted": `${NEEDS_RUST}: needs a deployed Worker (CLOUD-03's Worker tests own the routes)`,
	"cloud.pairing": `${NEEDS_RUST}: writes the real Keychain and needs a deployed Worker (CLOUD-07's live run owns it)`,
	"cloud.relay": `${NEEDS_RUST}: needs a deployed Worker (CLOUD-03's Worker tests own the relay)`,
	"portForward.start-stop": `${NEEDS_RUST}: binds a loopback listener and reads the Keychain (port_forward.rs tests own it)`,
	"conductorImport.move-secrets": `${NEEDS_RUST}: writes the macOS Keychain (conductor_import.rs tests own it)`,
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

	// conductor_import.rs opens the copy for each read and drops the connection when it answers.
	// A stand-in that kept each one open held 6 GB and 3,000 files after 3,000 reads (issue #556).
	it("APP-18 reads of Conductor's copy leave no connection open, as conductor_import.rs drops each", async () => {
		const dir = mkdtempSync(join(tmpdir(), "conducted-contract-"));
		const run = createNodeTauriBindings(dir);
		try {
			const tauri = await createTauriPlatform(run.bindings);
			if (!tauri.ok) throw new Error(tauri.error.message);
			const { conductorImport } = tauri.value;
			const source = join(dir, "outside", "conductor.db");
			await run.controls.seedConductorDatabase?.(source, {
				session_messages: [
					{
						id: "m",
						session_id: "s",
						role: "user",
						content: "hi",
						sent_at: "2026-01-01",
						created_at: "2026-01-01",
						turn_id: "t",
					},
				],
			});
			const copy = await conductorImport.copy(source);
			if (!copy.ok) throw new Error(copy.error.message);
			const openFiles = (): number => readdirSync("/dev/fd").length;
			const before = openFiles();
			for (let read = 0; read < 40; read++) {
				expect((await conductorImport.read(copy.value.copyPath)).ok).toBe(true);
				expect((await conductorImport.readMessageKeys(copy.value.copyPath, "s", 0, 10)).ok).toBe(
					true,
				);
				expect((await conductorImport.readMessages(copy.value.copyPath, "s", [1])).ok).toBe(true);
			}
			expect(openFiles() - before).toBeLessThan(5);
		} finally {
			await run.dispose();
			rmSync(dir, { recursive: true, force: true });
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

// ---------------------------------------------------------------- error codes (PLAT-02, PLAT-05)

const PLATFORM_DIR = fileURLToPath(new URL(".", import.meta.url));
const RUST_SRC = fileURLToPath(new URL("../../src-tauri/src/", import.meta.url));

/** Removes every `#[cfg(test)]` item, so a test's invented code is not mistaken for a command's. */
function withoutTestItems(source: string): string {
	let result = source;
	for (;;) {
		const at = result.indexOf("#[cfg(test)]");
		if (at < 0) return result;
		const open = result.indexOf("{", at);
		if (open < 0) return result.slice(0, at);
		let depth = 0;
		let end = -1;
		for (let index = open; index < result.length; index++) {
			if (result[index] === "{") depth++;
			else if (result[index] === "}") {
				depth--;
				if (depth === 0) {
					end = index + 1;
					break;
				}
			}
		}
		if (end < 0) return result.slice(0, at);
		result = result.slice(0, at) + result.slice(end);
	}
}

/** Every error code a Rust module builds, as `code: "..."` or as the first argument of `failed(`. */
function rustErrorCodes(source: string): string[] {
	const production = withoutTestItems(source);
	const codes = new Set<string>();
	for (const match of production.matchAll(/\bcode:\s*"([a-z0-9_]+)"/g)) {
		if (match[1] !== undefined) codes.add(match[1]);
	}
	for (const match of production.matchAll(/\b(?:failed|blocking)\s*\(\s*"([a-z0-9_]+)"/g)) {
		if (match[1] !== undefined) codes.add(match[1]);
	}
	return [...codes];
}

/** Every error code a TypeScript platform module builds with `appError` or `platformError`. */
function typescriptErrorCodes(source: string): string[] {
	const codes = new Set<string>();
	for (const match of source.matchAll(/(?:appError|platformError)\(\s*"([a-z0-9_]+)"/g)) {
		if (match[1] !== undefined) codes.add(match[1]);
	}
	return [...codes];
}

/** The body of one Rust function, so a test can read what that command answers. */
function rustFunctionBody(source: string, name: string): string {
	const signature = new RegExp(`\\b(?:pub\\s+)?(?:async\\s+)?fn\\s+${name}\\b`);
	const found = signature.exec(source);
	if (found === null) return "";
	const open = source.indexOf("{", found.index + found[0].length);
	if (open < 0) return "";
	let depth = 0;
	for (let index = open; index < source.length; index++) {
		if (source[index] === "{") depth++;
		else if (source[index] === "}") {
			depth--;
			if (depth === 0) return source.slice(open, index + 1);
		}
	}
	return source.slice(open);
}

describe("PLAT-02 the Platform's error codes are one list", () => {
	const known = new Set<string>(PLATFORM_ERROR_CODES);

	it("has no duplicate codes", () => {
		expect(known.size).toBe(PLATFORM_ERROR_CODES.length);
	});

	it("lists every code a Rust command can return", () => {
		const missing: string[] = [];
		// Every Rust source, those in a module's own folder (binaries/follow.rs) too.
		const sources = readdirSync(RUST_SRC, { recursive: true, encoding: "utf8" });
		for (const file of sources.filter((name) => name.endsWith(".rs"))) {
			const codes = rustErrorCodes(readFileSync(join(RUST_SRC, file), "utf8"));
			for (const code of codes) if (!known.has(code)) missing.push(`${file}: ${code}`);
		}
		expect(missing).toEqual([]);
	});

	it("lists every code the memory Platform and the Tauri bridge answer with", () => {
		const missing: string[] = [];
		for (const file of ["memory.ts", "tauri.ts"]) {
			const source = readFileSync(join(PLATFORM_DIR, file), "utf8");
			for (const code of typescriptErrorCodes(source)) {
				if (!known.has(code)) missing.push(`${file}: ${code}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it("still finds the codes when they move into a helper", () => {
		const source =
			'#[cfg(test)]\nmod tests { fn helper() { code: "made_up_test_code" } }\nfn real() { failed(\n  "real_code",\n  "x"); }';
		expect(rustErrorCodes(source)).toEqual(["real_code"]);
	});
});

describe("PLAT-05 a missing path answers fs_not_found on both sides", () => {
	const memory = memoryPlatformForShape();
	const missingPath = "/Users/conducted/.conducted/does-not-exist";

	it("readText, readDir and trash return fs_not_found in the memory Platform", async () => {
		expect(await memory.fs.readText(missingPath)).toMatchObject({
			ok: false,
			error: { code: "fs_not_found" },
		});
		expect(await memory.fs.readDir(missingPath)).toMatchObject({
			ok: false,
			error: { code: "fs_not_found" },
		});
		expect(await memory.fs.trash(missingPath)).toMatchObject({
			ok: false,
			error: { code: "fs_not_found" },
		});
		expect(await memory.fs.stat(missingPath)).toMatchObject({
			ok: false,
			error: { code: "fs_not_found" },
		});
	});

	it("the Rust commands and the Tauri bridge answer with the same code", () => {
		const files = readFileSync(join(RUST_SRC, "files.rs"), "utf8");
		for (const name of ["read_text_at", "read_dir_at", "trash_dir_for", "trash_into"]) {
			expect(rustFunctionBody(files, name), name).toContain("missing_as_not_found");
		}
		expect(files).toContain('code: "fs_not_found"');
		const bridge = readFileSync(join(PLATFORM_DIR, "tauri.ts"), "utf8");
		expect(bridge).toContain('platformError("fs_not_found"');
	});
});

describe("CHAT-22 the visualization store has the same limits on both sides", () => {
	/** The value of one Rust `usize` constant, with `*` products of integer literals. */
	const rustSize = (source: string, name: string): number | null => {
		const found = new RegExp(`pub const ${name}: usize = ([0-9_ *]+);`).exec(source);
		if (found?.[1] === undefined) return null;
		return found[1]
			.split("*")
			.map((factor) => Number(factor.trim().replaceAll("_", "")))
			.reduce((product, factor) => product * factor, 1);
	};
	const rust = readFileSync(join(RUST_SRC, "visualization.rs"), "utf8");

	it("keeps as many pages and bytes as visualization.rs does", () => {
		expect(rustSize(rust, "MAX_PAGES")).toBe(VISUALIZATION_MAX_PAGES);
		expect(rustSize(rust, "MAX_STORE_BYTES")).toBe(VISUALIZATION_MAX_STORE_BYTES);
	});

	it("flags a limit that drifts", () => {
		expect(rustSize("pub const MAX_PAGES: usize = 2 * 1_000;", "MAX_PAGES")).toBe(2000);
		expect(rustSize("const OTHER: usize = 3;", "MAX_PAGES")).toBeNull();
	});
});

describe("APP-17 the import reads the same tables on both sides", () => {
	/** The string items of one Rust `&[&str]` constant. */
	const rustList = (source: string, name: string): string[] => {
		const found = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\]`).exec(source);
		return [...(found?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? "");
	};
	const rust = readFileSync(join(RUST_SRC, "conductor_import.rs"), "utf8");

	it("lists the read and the counted tables as conductor_import.rs does", () => {
		expect(rustList(rust, "READ_TABLES")).toEqual([...CONDUCTOR_READ_TABLES]);
		expect(rustList(rust, "COUNTED_TABLES")).toEqual([...CONDUCTOR_COUNTED_TABLES]);
		expect(rust).toContain(`pub const COPY_FOLDER: &str = "${CONDUCTOR_COPY_FOLDER}";`);
	});

	it("flags a list that drifts", () => {
		expect(
			rustList('pub const READ_TABLES: &[&str] = &["repos", "other"];', "READ_TABLES"),
		).toEqual(["repos", "other"]);
	});
});
