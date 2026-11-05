/**
 * The quick local gate every overnight node passes before it may land: no tests and no Rust
 * builds run here (they run in the step's CI run). Plan: docs/plans/overnight-build.md.
 *
 * Checks, in order, stopping at the first failure:
 *  1. no placeholder is left for the feature id (notImplemented / not_implemented!);
 *  2. the feature has tests: a TypeScript test names the id in a describe or test title, or a
 *     Rust #[test] function name starts with the id in snake case (plat_03_...);
 *  3. pnpm typecheck, pnpm lint, pnpm guards;
 *  4. for Rust features, cargo fmt --check (formatting only, no build).
 *
 * Usage: bun scripts/overnight/node-gate.ts <FEATURE-ID>... (a batch's joining node passes every id)
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isTestFile, placeholderPattern, walk } from "../guards/lib.ts";

const TOP_FOLDERS = ["apps", "packages", "bin"];

/** Every source file under the repo's code folders, as [path relative to root, text]. */
export function readSources(root: string): [string, string][] {
	const files: [string, string][] = [];
	for (const top of TOP_FOLDERS) {
		for (const path of walk(root, join(root, top), /\.(ts|tsx|rs|sh)$/)) {
			files.push([relative(root, path), readFileSync(path, "utf8")]);
		}
	}
	return files;
}

/** Files that still hold a placeholder for the id. Test files do not count, as in `pnpm stubs`. */
export function placeholdersFor(id: string, files: Iterable<[string, string]>): string[] {
	const pattern = placeholderPattern(id);
	return [...files]
		.filter(([path, text]) => !isTestFile(path) && text.search(pattern) !== -1)
		.map(([path]) => path);
}

export function testsFor(id: string, files: Iterable<[string, string]>): string[] {
	const pattern = new RegExp(
		`(describe|test|it)(\\.each\\([^)]*\\))?\\(\\s*["'\`][^"'\`]*\\b${id}\\b`,
	);
	const rust = new RegExp(`#\\[test\\][\\s\\S]{0,200}?fn ${id.toLowerCase().replace("-", "_")}_`);
	return [...files]
		.filter(
			([path, text]) =>
				(isTestFile(path) && pattern.test(text)) || (path.endsWith(".rs") && rust.test(text)),
		)
		.map(([path]) => path);
}

function run(cmd: string[], cwd: string): boolean {
	const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
	return result.exitCode === 0;
}

if (import.meta.main) {
	const ids = process.argv.slice(2);
	if (ids.length === 0 || ids.some((id) => !/^[A-Z]+-\d{2}$/.test(id))) {
		console.error("Usage: bun scripts/overnight/node-gate.ts <FEATURE-ID>...");
		process.exit(64);
	}
	const root = process.cwd();
	const files = readSources(root);
	const counts: string[] = [];
	for (const id of ids) {
		const left = placeholdersFor(id, files);
		if (left.length > 0) {
			console.error(`${id} still has placeholders in:\n${left.map((p) => `  ${p}`).join("\n")}`);
			process.exit(1);
		}
		const tests = testsFor(id, files);
		if (tests.length === 0) {
			console.error(
				`No test names ${id}. Put the id in a describe or test title, for example describe("${id} ...").`,
			);
			process.exit(1);
		}
		counts.push(`${id} (${tests.length} test file(s))`);
	}
	for (const cmd of [
		["pnpm", "typecheck"],
		["pnpm", "lint"],
		["pnpm", "guards"],
	]) {
		if (!run(cmd, root)) process.exit(1);
	}
	const rust = files.some(
		([path, text]) => path.endsWith(".rs") && ids.some((id) => text.includes(`@feature ${id}`)),
	);
	if (rust && !run(["cargo", "fmt", "--check"], join(root, "apps/desktop/src-tauri")))
		process.exit(1);
	console.log(`gate passed: ${counts.join(", ")}.`);
}
