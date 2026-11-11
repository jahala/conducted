/**
 * Runs a command in a temp folder the run owns, and fails if the command leaves anything there.
 *
 * - The run gets `$TMPDIR/conducted-runs/<run id>/`, with an `owner.pid` file naming this process.
 * - `TMPDIR` (and `TMP`, `TEMP`) point into it, so every temp file a test makes lands there.
 * - When the command ends, the folder must be empty apart from `owner.pid`. Anything else is listed
 *   and the run fails. The folder is then removed either way.
 * - Folders left by a run that was killed (its recorded process is gone) are removed first.
 * - Git's background maintenance is off for every git process in the run. A commit can start a
 *   detached `git maintenance run --auto` that writes into a test's repository after the test
 *   removed it, which leaves a folder behind (issue #458). The settings go through git's own
 *   environment config, after any the caller already set.
 *
 * Usage: bun scripts/with-run-dir.ts <command> [args...]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OWNER = "owner.pid";
const base = join(process.env.TMPDIR ?? tmpdir(), "conducted-runs");

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * The process that owns a run folder: the pid in its owner file. A run writes that file a moment
 * after it makes the folder, so a folder without it falls back to the pid its name ends in.
 */
function ownerOf(dir: string, name: string): number {
	const owner = join(dir, name, OWNER);
	if (existsSync(owner)) return Number(readFileSync(owner, "utf8"));
	return Number(/-(\d+)$/.exec(name)?.[1] ?? Number.NaN);
}

/** Removes run folders whose owner process no longer exists. Returns how many were removed. */
export function removeDeadRuns(dir: string): number {
	if (!existsSync(dir)) return 0;
	let removed = 0;
	for (const name of readdirSync(dir)) {
		const pid = ownerOf(dir, name);
		if (!Number.isInteger(pid) || !alive(pid)) {
			rmSync(join(dir, name), { recursive: true, force: true });
			removed += 1;
		}
	}
	return removed;
}

/** The git settings that stop git starting background work a test cannot wait for. */
const QUIET_GIT: readonly (readonly [string, string])[] = [
	["maintenance.auto", "false"],
	["gc.auto", "0"],
	["gc.autoDetach", "false"],
];

/** `env` with QUIET_GIT appended to git's environment config, keeping the caller's entries. */
export function withQuietGit(
	env: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const start = Number(env.GIT_CONFIG_COUNT ?? "0");
	const first = Number.isInteger(start) && start >= 0 ? start : 0;
	const next: Record<string, string | undefined> = { ...env };
	QUIET_GIT.forEach(([key, value], index) => {
		next[`GIT_CONFIG_KEY_${first + index}`] = key;
		next[`GIT_CONFIG_VALUE_${first + index}`] = value;
	});
	next.GIT_CONFIG_COUNT = String(first + QUIET_GIT.length);
	return next;
}

/** Lists what a run left in its folder, ignoring the owner file. */
export function leftovers(runDir: string): string[] {
	return readdirSync(runDir).filter((name) => name !== OWNER);
}

if (import.meta.main) {
	const command = process.argv.slice(2);
	if (command.length === 0) {
		console.error("Usage: bun scripts/with-run-dir.ts <command> [args...]");
		process.exit(64);
	}
	mkdirSync(base, { recursive: true });
	const cleaned = removeDeadRuns(base);
	if (cleaned > 0)
		console.log(`Removed ${cleaned} folder(s) left by earlier runs that were killed.`);

	const runDir = join(base, `${Date.now()}-${process.pid}`);
	mkdirSync(runDir);
	writeFileSync(join(runDir, OWNER), String(process.pid));
	const env = withQuietGit({ ...process.env, TMPDIR: `${runDir}/`, TMP: runDir, TEMP: runDir });

	const child = Bun.spawnSync(command, { env, stdio: ["inherit", "inherit", "inherit"] });
	const left = leftovers(runDir);
	rmSync(runDir, { recursive: true, force: true });

	if (left.length > 0) {
		console.error(`\nThe run left ${left.length} item(s) in its temp folder:`);
		for (const name of left.slice(0, 20)) console.error(`  ${name}`);
		console.error("Every test must remove what it creates.");
		process.exit(child.exitCode === 0 ? 1 : (child.exitCode ?? 1));
	}
	process.exit(child.exitCode ?? 1);
}
