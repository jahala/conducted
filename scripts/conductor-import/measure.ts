/**
 * @feature APP-18 Timing the Conductor import at full size (issue #556)
 * Owns: `bun scripts/conductor-import/measure.ts <path-to-a-conductor-db-copy>`. It clones the copy
 * into a folder of its own, runs the real import on the clone into a scratch Conducted database
 * in that folder (measure-import.ts, in a Node child started through measure-node.ts), samples
 * the resident memory of the import's process and of the sidecar every 250 ms, and prints counts
 * and timings only: the dry run's counts, the dry run's and the import's time, the five slowest
 * chats as rows and seconds, the longest hold of the database queue, peak memory, and the time to
 * open the largest imported chat and build its turns.
 * Behaviour: docs/plans/migrate-from-conductor.md ("Chat history"); issue #556, "Done means".
 * Must handle: it never prints a value from either database: the child sends numbers and fixed
 * words only, and every printed number is checked to be one, so a string cannot reach a line; the
 * child's own output is never shown, since an error message could quote a row; a failure prints
 * its stage only; the copy and the folder beside it stay as they were, because only the clone is
 * opened; the folder, with the scratch database and the clone, is removed on every ending, a
 * failure or Ctrl-C included, after the child and the sidecar are stopped by their pids.
 * Test first: prints only lines from the fixed list, and leaves the copy and the project's folder
 * as they were.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import {
	conductorDatabasePath,
	IMPORT_KINDS,
} from "../../apps/desktop/src/core/conductor-import/plan.ts";
import type { Measured } from "./measure-import.ts";
import type { ChildMessage } from "./measure-node.ts";

const CHILD = join(import.meta.dir, "measure-node.ts");
const SAMPLE_MS = 250;
const STOP_GRACE_MS = 5_000;

/** The stages a failure may name. Anything else the child sends is printed as "unknown". */
const STAGES = new Set([
	"load",
	"setup",
	"start",
	"dry run",
	"import",
	"open the largest chat",
	"stop",
]);

/** The words for each kind the dry run counts. */
const KIND_WORDS: Record<(typeof IMPORT_KINDS)[number], string> = {
	repos: "projects",
	workspaces: "workspaces",
	chats: "chats",
	reviewComments: "review comments",
	sections: "sidebar sections",
	favoriteModels: "favourite models",
	settings: "settings",
	environmentVariables: "environment variables",
	scripts: "scripts",
};

/** A number, or the run stops: nothing but numbers is printed from what the child sent. */
function num(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error("The child sent something that is not a number.");
	}
	return value;
}
const int = (value: unknown): string => String(Math.round(num(value)));
const secs = (value: unknown): string => num(value).toFixed(2);
const mb = (kb: number): string => (kb / 1024).toFixed(0);

const TITLE = "Conductor import at full size: counts and timings only";

/** The dry run's lines, printed on their own when the import after it fails. */
function dryRunLines(dryRun: Measured["dryRun"]): string[] {
	const lines = [
		`dry run: ${secs(dryRun.seconds)} s, of which the copy of the database ${secs(dryRun.copySeconds)} s`,
		"dry run counts (found, to import, already there, left out):",
	];
	for (const kind of IMPORT_KINDS) {
		const count = dryRun.kinds[kind];
		lines.push(
			`  ${KIND_WORDS[kind]} ${int(count.found)} ${int(count.toImport)} ${int(count.alreadyThere)} ${int(count.leftOut)}`,
		);
	}
	const history = dryRun.history;
	lines.push(
		`dry run, chat history that comes: ${int(history.comes.chats)} chats, ${int(history.comes.rows)} rows`,
		`dry run, chat history already there: ${int(history.alreadyThere.chats)} chats, ${int(history.alreadyThere.rows)} rows`,
		`dry run, chats with no mapping yet: ${int(history.notMapped.chats)} chats, ${int(history.notMapped.rows)} rows`,
		`dry run, history staying behind with its chats: ${int(history.withChatsLeftOut.chats)} chats, ${int(history.withChatsLeftOut.rows)} rows`,
		`dry run, items listed as left out: ${int(dryRun.leftOut)}`,
		`dry run, settings files to write: ${int(dryRun.files)}`,
	);
	return lines;
}

/** The lines the run prints, all fixed words around numbers. */
export function reportLines(measured: Measured, memory: MemoryPeaks): string[] {
	const { dryRun, run, chats, queue, largest, reads, outside } = measured;
	const lines = [TITLE, ...dryRunLines(dryRun)];
	lines.push(
		`import: ${secs(run.seconds)} s, of which the rows ${secs(run.rowsSeconds)} s and chat history ${secs(run.historySeconds)} s`,
		`import, chat history: ${int(run.imported.chats)} chats came, ${int(run.imported.changed)} changed since the dry run, ${int(run.imported.failed)} failed`,
		`total, dry run and import: ${secs(num(dryRun.seconds) + num(run.seconds))} s`,
		`chats timed: ${int(chats.timed)}`,
		"slowest chats (rows, seconds):",
	);
	chats.slowest.forEach((chat, index) => {
		lines.push(`  ${index + 1}: ${int(chat.rows)} ${secs(chat.seconds)}`);
	});
	const longestBy =
		queue.longestRows === null ? "the rows' write" : `a chat of ${int(queue.longestRows)} rows`;
	lines.push(
		`database queue: held ${int(queue.holds)} times, longest ${secs(queue.longestSeconds)} s (${longestBy}); the rows' write held it ${secs(queue.rowsWriteSeconds)} s`,
		`reads of the copy: ${int(reads.keyPages)} pages of keys, ${int(reads.rowReads)} reads of rows`,
		`peak resident memory, sampled every ${SAMPLE_MS} ms: import process ${mb(memory.app)} MB (${mb(memory.baseline)} MB as the dry run began), sidecar ${mb(memory.sidecar)} MB, both together ${mb(memory.both)} MB (${int(memory.samples)} samples)`,
		largest === null
			? "largest chat: no chat has events"
			: `largest chat: ${int(largest.events)} events, ${int(largest.turns)} turns; opened in ${secs(largest.openSeconds)} s, turns built in ${secs(largest.turnsSeconds)} s`,
		`outside the run's folder: ${int(outside.kept)} files written by the import kept in the run's folder, ${int(outside.refusedWrites)} writes refused, ${int(outside.refusedCommands)} commands refused`,
	);
	return lines;
}

/** Peak resident set sizes in KiB. */
export interface MemoryPeaks {
	/** The import process when the app had started and the dry run began. */
	baseline: number;
	app: number;
	sidecar: number;
	both: number;
	samples: number;
}

/** Samples the two processes' resident memory with `ps`, by pid, every SAMPLE_MS. */
function startSampler(pids: { app: number; sidecar: () => number | null }): {
	markBaseline: () => void;
	stop: () => MemoryPeaks;
} {
	const peaks: MemoryPeaks = { baseline: 0, app: 0, sidecar: 0, both: 0, samples: 0 };
	let latestApp = 0;
	const sample = (): void => {
		const sidecar = pids.sidecar();
		const list = sidecar === null ? `${pids.app}` : `${pids.app},${sidecar}`;
		const ran = Bun.spawnSync(["ps", "-o", "pid=,rss=", "-p", list], { stdout: "pipe" });
		const rss = new Map<number, number>();
		for (const line of ran.stdout.toString().trim().split("\n")) {
			const [pid, kb] = line.trim().split(/\s+/).map(Number);
			if (pid !== undefined && kb !== undefined && Number.isFinite(kb)) rss.set(pid, kb);
		}
		const app = rss.get(pids.app) ?? 0;
		latestApp = app;
		const side = sidecar === null ? 0 : (rss.get(sidecar) ?? 0);
		peaks.app = Math.max(peaks.app, app);
		peaks.sidecar = Math.max(peaks.sidecar, side);
		peaks.both = Math.max(peaks.both, app + side);
		peaks.samples++;
	};
	const timer = setInterval(sample, SAMPLE_MS);
	return {
		markBaseline: () => {
			sample();
			peaks.baseline = latestApp;
		},
		stop: () => {
			clearInterval(timer);
			return peaks;
		},
	};
}

/** Clones the copy and its log into the place the import looks, so SQLite never opens the copy. */
function cloneCopy(source: string, target: string): void {
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(source, target, constants.COPYFILE_FICLONE);
	for (const side of ["-wal", "-journal"]) {
		if (existsSync(`${source}${side}`)) {
			copyFileSync(`${source}${side}`, `${target}${side}`, constants.COPYFILE_FICLONE);
		}
	}
}

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** Stops a process this run started, by its pid: SIGTERM, then SIGKILL after the grace. */
async function stopPid(pid: number): Promise<void> {
	if (!alive(pid)) return;
	process.kill(pid, "SIGTERM");
	const deadline = Date.now() + STOP_GRACE_MS;
	while (alive(pid) && Date.now() < deadline) await Bun.sleep(50);
	if (alive(pid)) process.kill(pid, "SIGKILL");
}

/** On a failure, `lines` holds the dry run's lines when the dry run finished. */
export type Outcome = { ok: true; lines: string[] } | { ok: false; stage: string; lines: string[] };

/** Runs the measurement on a clone of `source` and returns the lines to print, or the stage that failed. */
export async function runMeasure(source: string): Promise<Outcome> {
	const folder = mkdtempSync(join(tmpdir(), "cim-"));
	let child: ChildProcess | null = null;
	let sidecarPid: number | null = null;
	const stopAll = async (): Promise<void> => {
		if (child?.pid !== undefined) await stopPid(child.pid);
		if (sidecarPid !== null) await stopPid(sidecarPid);
	};
	const onSignal = (): void => {
		void stopAll().finally(() => {
			rmSync(folder, { recursive: true, force: true });
			process.exit(130);
		});
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	try {
		cloneCopy(source, conductorDatabasePath(join(folder, "home")));
		mkdirSync(join(folder, "tmp"));
		const started = spawn("node", [CHILD, folder, process.execPath], {
			env: {
				PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
				HOME: join(folder, "home"),
				TMPDIR: join(folder, "tmp"),
			},
			stdio: ["ignore", "ignore", "ignore", "pipe"],
		});
		child = started;
		const pid = started.pid;
		if (pid === undefined) return { ok: false, stage: "setup", lines: [] };
		const exited = new Promise<void>((done) => started.once("close", () => done()));
		const sampler = startSampler({ app: pid, sidecar: () => sidecarPid });
		let measured: Measured | null = null;
		let dryRun: Measured["dryRun"] | null = null;
		let failed: string | null = null;
		const lines = createInterface({ input: started.stdio[3] as Readable });
		for await (const line of lines) {
			const message = JSON.parse(line) as ChildMessage;
			if (message.kind === "sidecar") sidecarPid = num(message.pid);
			else if (message.kind === "started") sampler.markBaseline();
			else if (message.kind === "dryRun") dryRun = message.dryRun;
			else if (message.kind === "measured") measured = message.measured;
			else failed = STAGES.has(message.stage) ? message.stage : "unknown";
		}
		await exited;
		const memory = sampler.stop();
		if (measured === null) {
			const shown = dryRun === null ? [] : [TITLE, ...dryRunLines(dryRun)];
			return { ok: false, stage: failed ?? "unknown", lines: shown };
		}
		return { ok: true, lines: reportLines(measured, memory) };
	} finally {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		await stopAll();
		rmSync(folder, { recursive: true, force: true });
	}
}

async function main(argv: readonly string[]): Promise<number> {
	const [source] = argv;
	if (source === undefined || argv.length !== 1) {
		process.stderr.write(
			"usage: bun scripts/conductor-import/measure.ts <path-to-a-conductor-db-copy>\n",
		);
		return 2;
	}
	if (!existsSync(source) || !statSync(source).isFile()) {
		process.stderr.write("The path given is not a file.\n");
		return 2;
	}
	try {
		const outcome = await runMeasure(source);
		for (const line of outcome.lines) process.stdout.write(`${line}\n`);
		if (!outcome.ok) {
			process.stderr.write(`The measurement failed at: ${outcome.stage}\n`);
			return 1;
		}
		return 0;
	} catch (error) {
		// The message could quote a row, so only the kind of failure is printed.
		const kind = error instanceof Error ? error.name : typeof error;
		process.stderr.write(`The measurement failed (${kind}).\n`);
		return 1;
	}
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
