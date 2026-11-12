/**
 * Whether a pull request's changes can reach CI's macOS job (`rust` in .github/workflows/ci.yml):
 * the Rust checks and `pnpm test:macos`. GitHub's macOS runners are scarce, so a pull request that
 * changes none of the job's inputs skips it; a job skipped by its condition reports success, so
 * the required check passes. Main runs the job on every push, whatever this says.
 *
 * It prints `macos=true` or `macos=false` on stdout, for $GITHUB_OUTPUT, and on stderr the changed
 * paths that ask for the job. The rules are MACOS_JOB in scripts/test-rules.ts.
 *
 * Usage: bun scripts/macos-job.ts [--since <ref>]   (default origin/main)
 */
import { changedSince, runEverythingReasons } from "./run-tests.ts";
import { MACOS_JOB, type Rule } from "./test-rules.ts";

/** Why the changed files need the macOS job, one line per rule they hit; empty when none. */
export const macosJobReasons = (
	changed: readonly string[],
	rules: readonly Rule[] = MACOS_JOB,
): string[] => runEverythingReasons(changed, rules);

if (import.meta.main) {
	const args = process.argv.slice(2);
	const since = args[0] === "--since" && args.length === 2 ? args[1] : undefined;
	if (args.length > 0 && since === undefined) {
		console.error("Usage: bun scripts/macos-job.ts [--since <ref>]");
		process.exit(64);
	}
	const reasons = macosJobReasons(changedSince(since ?? "origin/main"));
	if (reasons.length === 0) console.error("No change reaches the macOS job.");
	else console.error(`The macOS job runs:\n${reasons.map((line) => `  ${line}`).join("\n")}`);
	console.log(`macos=${reasons.length > 0}`);
}
