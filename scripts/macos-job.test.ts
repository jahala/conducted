/**
 * CI's macOS job runs on a pull request only when the change can reach it (issue #641). The first
 * part checks the choice on small inputs. The second walks the macOS tests' imports, as the job's
 * selection does when it runs (issue #650). The third holds the rules to the repository: every path
 * the Rust crate names outside itself is on MACOS_JOB.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { macosJobInputs, macosJobReasons, macosTestInputs } from "./macos-job.ts";
import { MACOS_JOB, type Rule } from "./test-rules.ts";

const ROOT = realpathSync(join(import.meta.dir, ".."));
const CRATE = join(ROOT, "apps/desktop/src-tauri");
/** What the macOS tests import in this checkout, as the job's selection computes it. */
const INPUTS = new Set(macosJobInputs(ROOT));

describe("macosJobReasons", () => {
	test("a change to scripts or docs only does not ask for the job", () => {
		// The files #638 changed, the pull request that waited on a macOS runner for nothing.
		expect(
			macosJobReasons(
				[
					"scripts/e2e/harness.ts",
					"scripts/e2e/harness.test.ts",
					"docs/engineering.md",
					"CLAUDE.md",
				],
				INPUTS,
			),
		).toEqual([]);
		expect(macosJobReasons([], INPUTS)).toEqual([]);
	});

	test("a change to the Rust crate asks for the job", () => {
		expect(macosJobReasons(["apps/desktop/src-tauri/src/cloud.rs"], INPUTS)).toEqual([
			"apps/desktop/src-tauri/src/cloud.rs: the Rust crate: its code, tests, fixtures, Cargo.lock and rust-toolchain.toml",
		]);
		expect(macosJobReasons(["apps/desktop/src-tauri/rust-toolchain.toml"], INPUTS)).toHaveLength(1);
		expect(macosJobReasons(["apps/desktop/src-tauri/Cargo.lock"], INPUTS)).toHaveLength(1);
	});

	test("a change to ci.yml, a lockfile, a manifest or a runtime version asks for the job", () => {
		for (const path of [
			".github/workflows/ci.yml",
			"pnpm-lock.yaml",
			"package.json",
			"packages/protocol/package.json",
			".node-version",
			".bun-version",
		])
			expect(macosJobReasons([path], INPUTS)).toHaveLength(1);
		expect(macosJobReasons([".github/workflows/e2e.yml"], INPUTS)).toEqual([]);
	});

	test("a change the macOS tests import asks for the job", () => {
		expect(macosJobReasons(["apps/desktop/src/core/services/terminals.ts"], INPUTS)).toEqual([
			"apps/desktop/src/core/services/terminals.ts: the macOS tests import it",
		]);
		expect(macosJobReasons(["apps/desktop/src/test/setup.ts"], INPUTS)).toHaveLength(1);
		expect(macosJobReasons(["packages/shared/src/index.ts"], INPUTS)).toHaveLength(1);
		// No rule names the file: only the computed imports ask for the job.
		const imported = "apps/desktop/src/core/services/terminals.ts";
		expect(macosJobReasons([imported], new Set())).toEqual([]);
	});

	test("a UI change the job neither reads nor imports does not ask for it", () => {
		// The `programs` guard checks the UI's programs against ALLOWED_PROGRAMS on Linux, so no Rust
		// test reads the whole UI source (issue #647).
		expect(
			macosJobReasons(
				[
					"apps/desktop/src/features/chat/CodeBlock.tsx",
					"apps/desktop/src/core/git/xcode-license.ts",
				],
				INPUTS,
			),
		).toEqual([]);
	});
});

/** True when a change to `path` (from the repository root) runs the job. */
function reaches(path: string, rules: readonly Rule[] = MACOS_JOB): boolean {
	// A folder is reached when a change inside it is.
	const probe = isFolder(join(ROOT, path)) ? `${path}/any` : path;
	return macosJobReasons([probe], new Set(), rules).length > 0;
}

function isFolder(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

const trackedFiles = (pattern: string): string[] => {
	const result = Bun.spawnSync(["git", "ls-files", "-z", pattern], { cwd: ROOT });
	return result.stdout.toString().split("\0").filter(Boolean);
};

/**
 * The repository paths the crate names outside its own folder: what `include_str!` and
 * `include_bytes!` embed (from the naming file's folder), what code joins to the crate's folder
 * (`CARGO_MANIFEST_DIR` in the crate, `manifest` in build.rs), and the bundle's resources.
 */
function cratePaths(): string[] {
	const found = new Set<string>();
	const add = (path: string) => {
		const glob = path.endsWith("/*") ? path.slice(0, -2) : path;
		found.add(relative(ROOT, glob));
	};
	for (const file of trackedFiles("apps/desktop/src-tauri/*.rs")) {
		const text = readFileSync(join(ROOT, file), "utf8");
		for (const match of text.matchAll(/include_(?:str|bytes)!\(\s*"([^"]+)"\s*\)/g))
			add(resolve(dirname(join(ROOT, file)), match[1] ?? ""));
		for (const match of text.matchAll(
			/(?:env!\("CARGO_MANIFEST_DIR"\)\s*\)|Path::new\(&manifest\))\s*\.join\(\s*"([^"]+)"/g,
		))
			add(resolve(CRATE, match[1] ?? ""));
	}
	const config = JSON.parse(readFileSync(join(CRATE, "tauri.conf.json"), "utf8")) as {
		bundle: { resources: Record<string, string> };
	};
	for (const source of Object.keys(config.bundle.resources)) add(resolve(CRATE, source));
	return [...found].filter((path) => !path.startsWith("apps/desktop/src-tauri/")).sort();
}

describe("the macOS tests' imports", () => {
	const made: string[] = [];
	afterAll(() => {
		for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function workspace(files: Record<string, string>): string {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "macos-job-graph-")));
		made.push(root);
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
		return root;
	}

	test("a file a macOS test reaches through another file is an input, and one it does not is not", () => {
		const root = workspace({
			"a.macos.test.ts": 'import { b } from "./b.ts";\nb;',
			"setup.ts": 'import "./polyfill.ts";',
			"polyfill.ts": "export {};",
			"b.ts": 'import { c } from "./lib/c.ts";\nexport const b = c;',
			"lib/c.ts": 'import "node:fs";\nexport const c = 1;',
			"other.ts": "export const other = 1;",
		});
		expect(macosTestInputs(root, ["a.macos.test.ts", "setup.ts"])).toEqual([
			"a.macos.test.ts",
			"b.ts",
			"lib/c.ts",
			"polyfill.ts",
			"setup.ts",
		]);
	});

	test("an import that does not resolve stops the selection, so the job runs", () => {
		// A package that is not installed would cut the graph short without a word.
		const root = workspace({ "a.macos.test.ts": 'import { x } from "not-installed-here";\nx;' });
		expect(() => macosTestInputs(root, ["a.macos.test.ts"])).toThrow(
			'a.macos.test.ts imports "not-installed-here", which does not resolve',
		);
	});

	test("in this checkout they are the tests, the setup files and what those import", () => {
		expect(INPUTS.has("apps/desktop/src/core/services/terminals.run-09.zsh.macos.test.ts")).toBe(
			true,
		);
		expect(INPUTS.has("apps/desktop/src/core/services/terminals.ts")).toBe(true);
		expect(INPUTS.has("apps/desktop/src/test/setup.ts")).toBe(true);
		expect(INPUTS.has("apps/desktop/src/test/dom-polyfills.ts")).toBe(true);
		expect([...INPUTS].some((file) => file.startsWith("packages/shared/"))).toBe(true);
		expect(INPUTS.has("apps/desktop/src/features/chat/CodeBlock.tsx")).toBe(false);
	});
});

describe("MACOS_JOB covers what the job reads", () => {
	test("every path the Rust crate names outside itself is on the list", () => {
		const paths = cratePaths();
		// The scan still finds the paths it was written for, so a change in how the crate names
		// them cannot empty it.
		for (const known of [
			"packages/shared/fixtures/secret-names.json",
			"packages/sidecar/src",
			"packages/sidecar/package.json",
			"apps/desktop/src/platform/tauri.ts",
			"apps/desktop/src/core/app-paths.ts",
			"apps/cloud",
			"bin",
		])
			expect(paths).toContain(known);
		expect(paths.filter((path) => !reaches(path))).toEqual([]);
	});

	test("the check fails when a rule the crate needs is missing", () => {
		const without = MACOS_JOB.filter((rule) => rule.glob !== "packages/shared/**");
		expect(cratePaths().filter((path) => !reaches(path, without))).toEqual([
			"packages/shared/fixtures/secret-names.json",
			"packages/shared/fixtures/ssh-include.json",
		]);
	});
});
