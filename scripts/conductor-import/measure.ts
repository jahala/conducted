/**
 * @feature APP-18 Timing the Conductor import at full size (issue #556)
 * Owns: `bun scripts/conductor-import/measure.ts <path-to-a-conductor-db-copy>`. It clones the copy
 * into a folder of its own, runs the real import on the clone into a scratch Conducted database
 * in that folder (measure-import.ts, in a Node child started through measure-node.ts), samples
 * the resident memory of the import's process and of the sidecar every 250 ms, and prints counts
 * and timings only: the dry run's counts, the dry run's and the import's time, the five slowest
 * chats as rows and seconds, the longest hold of the database queue, peak memory in each stage
 * (the dry run, the import, and opening the largest chat, which loads all of it), the time to
 * open the largest imported chat and build its turns, and the dry run's estimate of the disk space
 * chat history takes beside the scratch database's file and journal after the import (D132). The
 * Rust shell clones the copy on APFS, and so does the Node stand-in, so neither copy takes space.
 * Behaviour: docs/plans/migrate-from-conductor.md ("Chat history"); issue #556, "Done means".
 * Must handle: it never prints a value from either database: the child sends numbers and fixed
 * words only, and every printed number is checked to be one, so a string cannot reach a line; the
 * child's own output is never shown, since an error message could quote a row; a failure prints
 * its stage only; the copy and the folder beside it stay as they were, because only the clone is
 * opened; the folder, with the scratch database and the clone, and the sidecar's socket folder in
 * /tmp are removed on every ending, a failure or Ctrl-C included, after the child and the sidecar
 * are stopped by their pids.
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
/** Where the sidecar's socket folder goes: short, whatever TMPDIR is. */
export const SOCKET_BASE = "/tmp/cim-s-";
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
		`dry run, disk space in bytes: chat history ${int(dryRun.space.historyBytes)}, needed free ${int(dryRun.space.neededBytes)}, free ${int(dryRun.space.freeBytes)}; ${dryRun.space.fits === true ? "it fits" : "it does not fit"}`,
	);
	return lines;
}

/** The lines the run prints, all fixed words around numbers. */
export function reportLines(measured: Measured, memory: MemoryPeaks): string[] {
	const { dryRun, run, chats, queue, largest, reads, outside, disk } = measured;
	const grew = num(disk.after.database) - num(disk.before.database);
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
		`database queue: held ${int(queue.holds)} times, longest ${secs(queue.longestSeconds)} s (${longestBy}); the rows' write held it ${secs(queue.rowsWriteSeconds)} s; the longest statement outside a transaction ${secs(queue.longestStatementSeconds)} s`,
		`reads of the copy: ${int(reads.keyPages)} pages of keys, ${int(reads.rowReads)} reads of rows`,
		`peak resident memory in MB, import process and sidecar, sampled every ${SAMPLE_MS} ms (${int(memory.samples)} samples):`,
		`  as the dry run began: ${mb(memory.baseline.app)}, ${mb(memory.baseline.sidecar)}`,
		...MEMORY_STAGES.map(
			(stage) => `  ${stage}: ${mb(memory.stages[stage].app)}, ${mb(memory.stages[stage].sidecar)}`,
		),
		largest === null
			? "largest chat: no chat has events"
			: `largest chat: ${int(largest.events)} events, ${int(largest.turns)} turns; opened in ${secs(largest.openSeconds)} s, turns built in ${secs(largest.turnsSeconds)} s`,
		`outside the run's folder: ${int(outside.kept)} files written by the import kept in the run's folder, ${int(outside.refusedWrites)} writes refused, ${int(outside.refusedCommands)} commands refused`,
		`scratch database in bytes, when the dry run ended: file ${int(disk.before.database)}, journal ${int(disk.before.journal)}`,
		`scratch database in bytes, after the import: file ${int(disk.after.database)}, journal ${int(disk.after.journal)}`,
		`chat history on disk: the file grew by ${int(grew)} bytes against the dry run's ${int(dryRun.space.historyBytes)}, a ratio of ${grew > 0 ? secs(num(dryRun.space.historyBytes) / grew) : "none"}`,
	);
	return lines;
}

/**
 * The stages memory is told apart by: the dry run, the import, and the measure's own open of the
 * largest chat, which loads every event of it and so must not be counted as the import's.
 */
const MEMORY_STAGES = ["dry run", "import", "opening the largest chat"] as const;
type MemoryStage = (typeof MEMORY_STAGES)[number];

/** Resident set sizes in KiB: the import's process and the sidecar. */
interface ProcessMemory {
	app: number;
	sidecar: number;
}

/** Peak resident set sizes in KiB, per stage. */
export interface MemoryPeaks {
	/** When the app had started and the dry run began. */
	baseline: ProcessMemory;
	stages: Record<MemoryStage, ProcessMemory>;
	samples: number;
}

/**
 * Samples the two processes' resident memory with `ps`, by pid, every SAMPLE_MS, and keeps each
 * stage's peaks. Entering a stage samples once first, so the stage before keeps its last value.
 */
function startSampler(pids: { app: number; sidecar: () => number | null }): {
	markBaseline: () => void;
	enter: (stage: MemoryStage) => void;
	stop: () => MemoryPeaks;
} {
	const peaks: MemoryPeaks = {
		baseline: { app: 0, sidecar: 0 },
		stages: {
			"dry run": { app: 0, sidecar: 0 },
			import: { app: 0, sidecar: 0 },
			"opening the largest chat": { app: 0, sidecar: 0 },
		},
		samples: 0,
	};
	let current: MemoryStage | null = null;
	const sample = (): ProcessMemory => {
		const sidecar = pids.sidecar();
		const list = sidecar === null ? `${pids.app}` : `${pids.app},${sidecar}`;
		const ran = Bun.spawnSync(["ps", "-o", "pid=,rss=", "-p", list], { stdout: "pipe" });
		const rss = new Map<number, number>();
		for (const line of ran.stdout.toString().trim().split("\n")) {
			const [pid, kb] = line.trim().split(/\s+/).map(Number);
			if (pid !== undefined && kb !== undefined && Number.isFinite(kb)) rss.set(pid, kb);
		}
		const now = {
			app: rss.get(pids.app) ?? 0,
			sidecar: sidecar === null ? 0 : (rss.get(sidecar) ?? 0),
		};
		if (current !== null) {
			const peak = peaks.stages[current];
			peak.app = Math.max(peak.app, now.app);
			peak.sidecar = Math.max(peak.sidecar, now.sidecar);
		}
		peaks.samples++;
		return now;
	};
	const timer = setInterval(sample, SAMPLE_MS);
	const enter = (stage: MemoryStage): void => {
		sample();
		current = stage;
		sample();
	};
	return {
		markBaseline: () => {
			peaks.baseline = sample();
			enter("dry run");
		},
		enter,
		stop: () => {
			clearInterval(timer);
			sample();
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
	// The sidecar's socket. A Unix socket's path holds about 104 bytes on macOS, and a test run's
	// TMPDIR is long enough to pass that, so the socket has a short folder of its own in /tmp.
	const socketFolder = mkdtempSync(SOCKET_BASE);
	const removeFolders = (): void => {
		rmSync(folder, { recursive: true, force: true });
		rmSync(socketFolder, { recursive: true, force: true });
	};
	let child: ChildProcess | null = null;
	let sidecarPid: number | null = null;
	const stopAll = async (): Promise<void> => {
		if (child?.pid !== undefined) await stopPid(child.pid);
		if (sidecarPid !== null) await stopPid(sidecarPid);
	};
	const onSignal = (): void => {
		void stopAll().finally(() => {
			removeFolders();
			process.exit(130);
		});
	};
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	try {
		cloneCopy(source, conductorDatabasePath(join(folder, "home")));
		mkdirSync(join(folder, "tmp"));
		const started = spawn("node", [CHILD, folder, process.execPath, socketFolder], {
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
			else if (message.kind === "dryRun") {
				dryRun = message.dryRun;
				sampler.enter("import");
			} else if (message.kind === "imported") sampler.enter("opening the largest chat");
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
		removeFolders();
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
