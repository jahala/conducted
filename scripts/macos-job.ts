/**
 * Whether a pull request's changes can reach CI's macOS job (`rust` in .github/workflows/ci.yml):
 * the Rust checks and `pnpm test:macos`. GitHub's macOS runners are scarce, so a pull request that
 * changes none of the job's inputs skips it; a job skipped by its condition reports success, so
 * the required check passes. Main runs the job on every push, whatever this says.
 *
 * The inputs are MACOS_JOB in scripts/test-rules.ts, and every file the macOS tests import, with
 * the Vitest setup files: that import graph is walked when this runs, as the TypeScript job's
 * changed-only selection walks its tests' imports (issue #650, D149). An import that does not
 * resolve stops it with an error, and a failed run makes CI run the job.
 *
 * It prints `macos=true` or `macos=false` on stdout, for $GITHUB_OUTPUT, and on stderr the changed
 * paths that ask for the job.
 *
 * Usage: bun scripts/macos-job.ts [--since <ref>]   (default origin/main)
 */
import { readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { changedSince, runEverythingReasons, scanImports } from "./run-tests.ts";
import { MACOS_JOB, type Rule } from "./test-rules.ts";

/**
 * Why the changed files need the macOS job: one line per rule they hit, and one for the first
 * changed file that no rule names and the macOS tests import. Empty when none.
 */
export function macosJobReasons(
	changed: readonly string[],
	inputs: ReadonlySet<string>,
	rules: readonly Rule[] = MACOS_JOB,
): string[] {
	const reasons = runEverythingReasons(changed, rules);
	const named = (path: string) => rules.some((rule) => new Bun.Glob(rule.glob).match(path));
	const imported = changed.find((path) => inputs.has(path) && !named(path));
	if (imported !== undefined) reasons.push(`${imported}: the macOS tests import it`);
	return reasons;
}

/**
 * Every repository file (from `root`) that the files in `starts` import at run time, through every
 * import, `starts` included, in name order. An import that does not resolve throws, naming it: a
 * package that is not installed would otherwise cut the graph short without a word.
 */
export function macosTestInputs(root: string, starts: readonly string[]): string[] {
	const seen = new Set<string>();
	const queue = starts.map((file) => join(root, file));
	for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
		if (seen.has(file)) continue;
		seen.add(file);
		const name = relative(root, file);
		const scanned = scanImports(file, readFileSync(file, "utf8"));
		if (scanned === "unreadable") throw new Error(`${name} does not parse.`);
		const [missing] = scanned.missing;
		if (missing !== undefined) {
			throw new Error(
				`${name} imports "${missing}", which does not resolve. Install the packages first.`,
			);
		}
		queue.push(...scanned.imports);
	}
	return [...seen].map((file) => relative(root, file)).sort();
}

/** The setup files Vitest runs before every desktop test, the macOS ones too (vite.config.ts). */
function desktopSetupFiles(root: string): string[] {
	const config = readFileSync(join(root, "apps/desktop/vite.config.ts"), "utf8");
	const list = /setupFiles:\s*\[([^\]]*)\]/.exec(config)?.[1];
	if (list === undefined) throw new Error("apps/desktop/vite.config.ts names no setupFiles.");
	return [...list.matchAll(/"([^"]+)"/g)].map((match) =>
		relative(root, resolve(root, "apps/desktop", match[1] ?? "")),
	);
}

/** The macOS tests git tracks, the setup files Vitest runs before them, and what they import. */
export function macosJobInputs(root: string): string[] {
	const listed = Bun.spawnSync(["git", "ls-files", "-z", "*.macos.test.ts"], { cwd: root });
	if (listed.exitCode !== 0) throw new Error(`git ls-files failed: ${listed.stderr.toString()}`);
	const tests = listed.stdout.toString().split("\0").filter(Boolean);
	if (tests.length === 0) throw new Error("git lists no *.macos.test.ts file.");
	return macosTestInputs(root, [...tests, ...desktopSetupFiles(root)]);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const since = args[0] === "--since" && args.length === 2 ? args[1] : undefined;
	if (args.length > 0 && since === undefined) {
		console.error("Usage: bun scripts/macos-job.ts [--since <ref>]");
		process.exit(64);
	}
	const root = realpathSync(join(import.meta.dir, ".."));
	const inputs = new Set(macosJobInputs(root));
	const reasons = macosJobReasons(changedSince(since ?? "origin/main"), inputs);
	if (reasons.length === 0) console.error("No change reaches the macOS job.");
	else console.error(`The macOS job runs:\n${reasons.map((line) => `  ${line}`).join("\n")}`);
	console.log(`macos=${reasons.length > 0}`);
}
