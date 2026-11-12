/**
 * Stopping our app and everything it started, by the process ids the caller recorded. The live
 * reference run (conductor-reference/live.ts) and the end-to-end tests (e2e/) both start the real
 * app and must leave no process behind.
 *
 * - `descendants` finds the processes under a pid by parent id (`pgrep -P` prints ids only, never a
 *   command line).
 * - `stopApp` records the processes under the app first, sends the app SIGTERM (SIGKILL after a
 *   quarter of the hang limit), then stops each recorded process that outlived it: the sidecar
 *   outlives a signalled app until its parent watchdog notices.
 * - Nothing here finds a process by name or pattern, so it can only stop what the caller started.
 */
import { type ChildProcess, spawnSync } from "node:child_process";

/** Catches an app that never stops. It is not a way to wait. */
const HANG_MS = 60_000;

/** Every process under `pid`, each before its own children. */
export function descendants(pid: number): number[] {
	const found = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
	const children = found.stdout
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map(Number);
	return children.flatMap((child) => [child, ...descendants(child)]);
}

/** True while a process with this id exists. */
export const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** Resolves when the child has exited; at once when it already has. */
export async function exited(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

/**
 * Stops the processes in `left` that are still running: SIGTERM, fifty checks a tenth of a second
 * apart, then SIGKILL for any that ignored it. Returns the ids that were still running.
 */
export async function stopLeftovers(left: readonly number[]): Promise<number[]> {
	const running = left.filter(alive);
	for (const id of running) process.kill(id, "SIGTERM");
	for (let check = 0; check < 50 && running.some(alive); check++) await Bun.sleep(100);
	for (const id of running.filter(alive)) process.kill(id, "SIGKILL");
	return running;
}

/** Stops the app and everything it started, by the pids recorded before the signal. */
export async function stopApp(child: ChildProcess): Promise<string[]> {
	const pid = child.pid;
	if (pid === undefined) return [];
	const under = descendants(pid);
	child.kill("SIGTERM");
	const hang = setTimeout(() => child.kill("SIGKILL"), HANG_MS / 4);
	await exited(child);
	clearTimeout(hang);
	return (await stopLeftovers(under)).map(String);
}
