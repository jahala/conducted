/**
 * CI's macOS job runs on a pull request only when the change can reach it (issue #641). The first
 * part checks the choice on small inputs. The second holds the rules to the repository: every path
 * the Rust crate names outside itself, and every file the macOS tests import, is on MACOS_JOB.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { macosJobReasons } from "./macos-job.ts";
import { importsOf } from "./run-tests.ts";
import { MACOS_JOB, type Rule } from "./test-rules.ts";

const ROOT = realpathSync(join(import.meta.dir, ".."));
const CRATE = join(ROOT, "apps/desktop/src-tauri");

describe("macosJobReasons", () => {
	test("a change to scripts or docs only does not ask for the job", () => {
		// The files #638 changed, the pull request that waited on a macOS runner for nothing.
		expect(
			macosJobReasons([
				"scripts/e2e/harness.ts",
				"scripts/e2e/harness.test.ts",
				"docs/engineering.md",
				"CLAUDE.md",
			]),
		).toEqual([]);
		expect(macosJobReasons([])).toEqual([]);
	});

	test("a change to the Rust crate asks for the job", () => {
		expect(macosJobReasons(["apps/desktop/src-tauri/src/cloud.rs"])).toEqual([
			"apps/desktop/src-tauri/src/cloud.rs: the Rust crate: its code, tests, fixtures, Cargo.lock and rust-toolchain.toml",
		]);
		expect(macosJobReasons(["apps/desktop/src-tauri/rust-toolchain.toml"])).toHaveLength(1);
		expect(macosJobReasons(["apps/desktop/src-tauri/Cargo.lock"])).toHaveLength(1);
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
			expect(macosJobReasons([path])).toHaveLength(1);
		expect(macosJobReasons([".github/workflows/e2e.yml"])).toEqual([]);
	});

	test("a change the macOS tests import asks for the job", () => {
		expect(macosJobReasons(["apps/desktop/src/core/services/terminals.ts"])).toHaveLength(1);
		expect(macosJobReasons(["packages/shared/src/index.ts"])).toHaveLength(1);
	});
});

/** True when a change to `path` (from the repository root) runs the job. */
function reaches(path: string, rules: readonly Rule[] = MACOS_JOB): boolean {
	// A folder is reached when a change inside it is.
	const probe = isFolder(join(ROOT, path)) ? `${path}/any` : path;
	return macosJobReasons([probe], rules).length > 0;
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

/** Every repository file the macOS tests import at run time, the tests included. */
function macosTestInputs(): string[] {
	const seen = new Set<string>();
	const queue = trackedFiles("*.macos.test.ts").map((file) => join(ROOT, file));
	for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
		if (seen.has(file)) continue;
		seen.add(file);
		const found = importsOf(file, readFileSync(file, "utf8"));
		if (found === "unreadable") throw new Error(`${relative(ROOT, file)} does not parse`);
		queue.push(...found);
	}
	return [...seen].map((file) => relative(ROOT, file)).sort();
}

describe("MACOS_JOB covers what the job reads", () => {
	test("every path the Rust crate names outside itself is on the list", () => {
		const paths = cratePaths();
		// The scan still finds the paths it was written for, so a change in how the crate names
		// them cannot empty it.
		for (const known of [
			"packages/shared/fixtures/secret-names.json",
			"packages/sidecar/src",
			"packages/sidecar/package.json",
			"apps/desktop/src",
			"apps/cloud",
			"bin",
		])
			expect(paths).toContain(known);
		expect(paths.filter((path) => !reaches(path))).toEqual([]);
	});

	test("every file the macOS tests import is on the list", () => {
		const inputs = macosTestInputs();
		expect(inputs).toContain("apps/desktop/src/core/services/terminals.ts");
		expect(inputs.some((file) => file.startsWith("packages/shared/"))).toBe(true);
		expect(inputs.filter((file) => !reaches(file))).toEqual([]);
	});

	test("the check fails when a rule the crate needs is missing", () => {
		const without = MACOS_JOB.filter((rule) => rule.glob !== "packages/shared/**");
		expect(cratePaths().filter((path) => !reaches(path, without))).toEqual([
			"packages/shared/fixtures/secret-names.json",
			"packages/shared/fixtures/ssh-include.json",
		]);
	});
});
