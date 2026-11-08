/**
 * The run-folder wrapper must fail a run that leaves files behind, pass a clean run, and remove
 * folders left by killed runs.
 */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeDeadRuns } from "./with-run-dir.ts";

const script = join(import.meta.dir, "with-run-dir.ts");

function wrapped(code: string) {
	const outer = mkdtempSync(join(tmpdir(), "runs-"));
	const run = Bun.spawnSync(["bun", script, "bun", "-e", code], {
		env: { ...process.env, TMPDIR: `${outer}/` },
		stderr: "pipe",
		stdout: "pipe",
	});
	const runsLeft = existsSync(join(outer, "conducted-runs"))
		? readdirSync(join(outer, "conducted-runs")).length
		: 0;
	rmSync(outer, { recursive: true, force: true });
	return { exitCode: run.exitCode, stderr: run.stderr.toString(), runsLeft };
}

test("a run that leaves a file fails and names it", () => {
	const result = wrapped(
		'require("node:fs").writeFileSync(require("node:path").join(require("node:os").tmpdir(), "left.txt"), "x")',
	);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("left.txt");
	expect(result.runsLeft).toBe(0);
});

test("a clean run passes and removes its folder", () => {
	const result = wrapped("1 + 1");
	expect(result.exitCode).toBe(0);
	expect(result.runsLeft).toBe(0);
});

test("folders of killed runs are removed, live ones are kept", () => {
	const dir = mkdtempSync(join(tmpdir(), "dead-"));
	mkdirSync(join(dir, "dead"));
	writeFileSync(join(dir, "dead", "owner.pid"), "999999999");
	mkdirSync(join(dir, "live"));
	writeFileSync(join(dir, "live", "owner.pid"), String(process.pid));
	// A run that has made its folder but not yet written the owner file is still alive.
	mkdirSync(join(dir, `1700000000000-${process.pid}`));
	mkdirSync(join(dir, "1700000000000-999999999"));
	expect(removeDeadRuns(dir)).toBe(2);
	expect(existsSync(join(dir, `1700000000000-${process.pid}`))).toBe(true);
	expect(existsSync(join(dir, "1700000000000-999999999"))).toBe(false);
	expect(existsSync(join(dir, "dead"))).toBe(false);
	expect(existsSync(join(dir, "live"))).toBe(true);
	rmSync(dir, { recursive: true, force: true });
});

/** What `git config --get <key>` says inside a wrapped run, given extra environment. */
function gitConfigInRun(key: string, extra: Record<string, string> = {}): string {
	const outer = mkdtempSync(join(tmpdir(), "runs-"));
	try {
		const run = Bun.spawnSync(["bun", script, "git", "config", "--get", key], {
			env: { ...process.env, ...extra, TMPDIR: `${outer}/` },
			stderr: "pipe",
			stdout: "pipe",
		});
		return run.stdout.toString().trim();
	} finally {
		rmSync(outer, { recursive: true, force: true });
	}
}

// Issue #458: a commit starts a detached `git maintenance run --auto` that can write into a test's
// repository after the test removed it, so the run's temp folder is not empty at the end.
test("git's background maintenance is off for every git process in a run", () => {
	expect(gitConfigInRun("maintenance.auto")).toBe("false");
	expect(gitConfigInRun("gc.auto")).toBe("0");
	expect(gitConfigInRun("gc.autoDetach")).toBe("false");
});

test("a run keeps the git settings its caller already passed through the environment", () => {
	const caller = {
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "user.name",
		GIT_CONFIG_VALUE_0: "Sam",
	};
	expect(gitConfigInRun("user.name", caller)).toBe("Sam");
	expect(gitConfigInRun("maintenance.auto", caller)).toBe("false");
});
