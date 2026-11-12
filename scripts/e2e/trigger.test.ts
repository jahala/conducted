/**
 * The e2e workflow runs on a pull request only when the change can reach the run (issue #641):
 * what the test app is built from and what `pnpm test:e2e` imports. This holds the workflow's
 * `paths` list to the imports of the run, the sidecar's build and the desktop's bundle check, and
 * to the bundle's resources, and checks that test files the build never reads are left out.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { importsOf } from "../run-tests.ts";

const ROOT = realpathSync(join(import.meta.dir, "../.."));
const CRATE = join(ROOT, "apps/desktop/src-tauri");

/** The pull request `paths` filter of .github/workflows/e2e.yml, in order. */
function triggerPaths(): string[] {
	const workflow = Bun.YAML.parse(
		readFileSync(join(ROOT, ".github/workflows/e2e.yml"), "utf8"),
	) as {
		on: { pull_request: { paths: string[] } };
	};
	return workflow.on.pull_request.paths;
}

/** Whether a change to `path` starts the workflow: as GitHub reads `paths`, the last match wins. */
function triggers(path: string, patterns: readonly string[]): boolean {
	let hit = false;
	for (const pattern of patterns) {
		const negated = pattern.startsWith("!");
		if (new Bun.Glob(negated ? pattern.slice(1) : pattern).match(path)) hit = !negated;
	}
	return hit;
}

/** Every repository file the entry files import at run time, the entries included. */
function closure(entries: readonly string[]): string[] {
	const seen = new Set<string>();
	const queue = entries.map((file) => join(ROOT, file));
	for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
		if (seen.has(file)) continue;
		seen.add(file);
		const found = importsOf(file, readFileSync(file, "utf8"));
		if (found === "unreadable") throw new Error(`${relative(ROOT, file)} does not parse`);
		queue.push(...found);
	}
	return [...seen].map((file) => relative(ROOT, file)).sort();
}

describe("the e2e workflow's paths", () => {
	const patterns = triggerPaths();

	test("cover every file the run, the sidecar's build and the bundle check import", () => {
		const inputs = closure([
			"scripts/e2e/run.ts",
			"packages/sidecar/src/packaging.ts",
			"packages/sidecar/src/main.ts",
			"scripts/catalogue/check-bundle.ts",
		]);
		expect(inputs).toContain("scripts/conductor-reference/world-disk.ts");
		expect(inputs).toContain("packages/protocol/src/index.ts");
		expect(inputs.filter((file) => !triggers(file, patterns))).toEqual([]);
	});

	test("cover every resource the app bundles from outside the crate", () => {
		const config = JSON.parse(readFileSync(join(CRATE, "tauri.conf.json"), "utf8")) as {
			bundle: { resources: Record<string, string> };
		};
		const sources = Object.keys(config.bundle.resources).map((source) =>
			relative(ROOT, resolve(CRATE, source.replace(/\/\*$/, "/any"))),
		);
		expect(sources).toContain("bin/any");
		expect(sources.filter((source) => !triggers(source, patterns))).toEqual([]);
	});

	test("cover the runtime versions and the install's inputs", () => {
		for (const path of [
			".node-version",
			".bun-version",
			"pnpm-lock.yaml",
			"pnpm-workspace.yaml",
			"apps/cloud/package.json",
			"scripts/check-runtime.ts",
		])
			expect(triggers(path, patterns)).toBe(true);
	});

	test("leave out what cannot reach the run", () => {
		for (const path of [
			"scripts/e2e/harness.test.ts",
			"packages/sidecar/src/config.test.ts",
			"apps/desktop/src-tauri/tests/plat_36.rs",
			"docs/engineering.md",
			"scripts/run-tests.ts",
		])
			expect(triggers(path, patterns)).toBe(false);
		// The desktop's build type-checks its tests, so a desktop test still starts the run.
		expect(triggers("apps/desktop/src/core/model.test.ts", patterns)).toBe(true);
	});
});
