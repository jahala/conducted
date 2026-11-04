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
 * Usage: bun scripts/overnight/node-gate.ts <FEATURE-ID>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP = new Set(["node_modules", "dist", "target", "gen", ".git", ".context"]);

export function* sourceFiles(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* sourceFiles(path);
		else if (/\.(ts|tsx|rs|sh)$/.test(name)) yield path;
	}
}

export function placeholdersFor(id: string, files: Iterable<[string, string]>): string[] {
	const pattern = new RegExp(`not_?[iI]mplemented!?\\s*\\(?\\s*"${id}"`);
	return [...files].filter(([, text]) => pattern.test(text)).map(([path]) => path);
}

export function testsFor(id: string, files: Iterable<[string, string]>): string[] {
	const pattern = new RegExp(
		`(describe|test|it)(\\.each\\([^)]*\\))?\\(\\s*["'\`][^"'\`]*\\b${id}\\b`,
	);
	const rust = new RegExp(`#\\[test\\][\\s\\S]{0,200}?fn ${id.toLowerCase().replace("-", "_")}_`);
	return [...files]
		.filter(
			([path, text]) =>
				(/\.test\.tsx?$/.test(path) && pattern.test(text)) ||
				(path.endsWith(".rs") && rust.test(text)),
		)
		.map(([path]) => path);
}

function run(cmd: string[], cwd: string): boolean {
	const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
	return result.exitCode === 0;
}

if (import.meta.main) {
	const id = process.argv[2];
	if (!id || !/^[A-Z]+-\d{2}$/.test(id)) {
		console.error("Usage: bun scripts/overnight/node-gate.ts <FEATURE-ID>");
		process.exit(64);
	}
	const root = process.cwd();
	const files: [string, string][] = [];
	for (const top of ["apps", "packages", "bin"]) {
		for (const path of sourceFiles(join(root, top)))
			files.push([relative(root, path), readFileSync(path, "utf8")]);
	}
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
	for (const cmd of [
		["pnpm", "typecheck"],
		["pnpm", "lint"],
		["pnpm", "guards"],
	]) {
		if (!run(cmd, root)) process.exit(1);
	}
	const rust = files.some(
		([path, text]) => path.endsWith(".rs") && text.includes(`@feature ${id}`),
	);
	if (rust && !run(["cargo", "fmt", "--check"], join(root, "apps/desktop/src-tauri")))
		process.exit(1);
	console.log(`${id}: gate passed (${tests.length} test file(s)).`);
}
