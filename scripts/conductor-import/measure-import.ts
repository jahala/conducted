/**
 * @feature APP-18 Timing the Conductor import at full size: the run inside Node
 * Owns: `measureImport`, which runs the real import through the real container over
 * `createTauriPlatform` and the Node stand-in for the Rust shell (src/test/tauri-node-bindings.ts),
 * with the real sidecar process answering over its socket, into a scratch Conducted database, and
 * returns counts, timings and sizes only: the dry run's estimate of the disk space chat history
 * takes, and the scratch database's file and journal when the dry run ended and after the import
 * (D132). measure.ts starts it in a Node child (measure-node.ts), because
 * the stand-in reads SQLite with node:sqlite, which Bun does not have.
 * Behaviour: docs/plans/migrate-from-conductor.md ("Chat history"); issue #556.
 * Must handle: nothing outside the run's folder is written: a file the import writes into a
 * project's folder (its new `.conducted/settings.toml`, the git exclude) is kept under the run's
 * folder at the same path and read back from there, every other write outside is refused, and
 * only the read-only commands the import runs (`git worktree list --porcelain`, `lsof`) reach the
 * shell; the database commands (`db_open`, `db_execute`, `db_select`) reach a migrated scratch
 * file, and the queue is timed on that raw handle, from BEGIN IMMEDIATE to COMMIT or ROLLBACK, so
 * the import's code is unchanged; the sidecar is stopped by the pid it was started
 * with, whatever happens; no value from either database leaves this module, only numbers.
 * Our design choice: a write into a project's folder is kept in the run's folder rather than
 * refused, because a refused write fails the whole import, and the files are a few bytes beside
 * the history the run measures.
 * Test first: scripts/conductor-import/measure.test.ts, "prints only lines from the fixed list".
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	conductorDatabasePath,
	IMPORT_KINDS,
	type ImportKind,
	type KindCount,
} from "../../apps/desktop/src/core/conductor-import/plan.ts";
import { createContainer } from "../../apps/desktop/src/core/container.ts";
import { tomlCodec } from "../../apps/desktop/src/core/services/toml-codec.ts";
import { createPlaceNames } from "../../apps/desktop/src/core/services/workspace-creation.ts";
import { writeRedactedReport } from "../../apps/desktop/src/features/diagnostics/diagnostics-report.ts";
import type { ShellCommand } from "../../apps/desktop/src/platform/platform.ts";
import type { SqlDatabase } from "../../apps/desktop/src/platform/queued-database.ts";
import {
	COMMANDS,
	createTauriPlatform,
	EVENTS,
	type TauriBindings,
} from "../../apps/desktop/src/platform/tauri.ts";
import { databaseCommands } from "../../apps/desktop/src/test/database-commands.ts";
import { createNodeSqlDatabase } from "../../apps/desktop/src/test/node-sql.ts";
import { createNodeTauriBindings } from "../../apps/desktop/src/test/tauri-node-bindings.ts";
import { cryptoIds, systemClock } from "../../packages/shared/src/clock.ts";

const REPO = resolve(import.meta.dirname, "../..");
const MIGRATIONS = join(REPO, "apps/desktop/src-tauri/migrations");
const SIDECAR_MAIN = join(REPO, "packages/sidecar/src/main.ts");
const SIDECAR_BIN = join(REPO, "bin");
/** Only catches a sidecar that never starts. It starts in well under a second. */
const SIDECAR_START_LIMIT_MS = 30_000;
const SIDECAR_STOP_GRACE_MS = 5_000;

/** The stages a failure is reported at. Fixed words only. */
export const STAGES = [
	"setup",
	"start",
	"dry run",
	"import",
	"open the largest chat",
	"stop",
] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Raised with a stage. The cause stays in this process for a debugger and is never sent on: its
 * message could quote a row.
 */
export class StageFailure extends Error {
	readonly stage: Stage;

	constructor(stage: Stage, cause?: unknown) {
		super(`The run failed at: ${stage}`, { cause });
		this.stage = stage;
	}
}

export interface ChatTiming {
	rows: number;
	seconds: number;
}

/** Everything the run reports. Numbers only, so nothing from a database can be printed. */
export interface Measured {
	dryRun: {
		seconds: number;
		/** The stand-in's copy of Conductor's database, inside the dry run. */
		copySeconds: number;
		kinds: Record<ImportKind, KindCount>;
		history: {
			comes: { chats: number; rows: number };
			alreadyThere: { chats: number; rows: number };
			notMapped: { chats: number; rows: number };
			withChatsLeftOut: { chats: number; rows: number };
		};
		leftOut: number;
		files: number;
		/** The dry run's space check (D132), in bytes. */
		space: { historyBytes: number; neededBytes: number; freeBytes: number; fits: boolean };
	};
	run: {
		seconds: number;
		/** From the start of the import to the first chat's history. */
		rowsSeconds: number;
		historySeconds: number;
		imported: { chats: number; changed: number; failed: number };
	};
	chats: { timed: number; slowest: ChatTiming[] };
	queue: {
		holds: number;
		longestSeconds: number;
		/** The rows of the chat whose history held it longest; null when it was the rows' write. */
		longestRows: number | null;
		rowsWriteSeconds: number;
	};
	largest: { events: number; turns: number; openSeconds: number; turnsSeconds: number } | null;
	reads: { keyPages: number; rowReads: number };
	outside: { kept: number; refusedWrites: number; refusedCommands: number };
	/** The scratch database's file and its journal, in bytes, when the dry run ended and after the import. */
	disk: { before: FileBytes; after: FileBytes };
}

export interface FileBytes {
	database: number;
	journal: number;
}

export interface MeasureInput {
	/**
	 * A new folder the caller made and removes. Everything the run writes lives in it, and the
	 * clone of the copy is at `cloneTarget(folder)`.
	 */
	folder: string;
	/** Bun, which runs the sidecar as the packaged app's sidecar runs. */
	bunPath: string;
	/** A short folder the caller made and removes, for the sidecar's socket. */
	socketFolder: string;
	/** Told the sidecar's pid as soon as it runs, so the caller can sample its memory. */
	onSidecar: (pid: number) => void;
	/** Told when the app has started and the dry run begins, so memory has a baseline. */
	onStarted: () => void;
	/** Told the dry run's counts as soon as they are known, so a failed import still shows them. */
	onDryRun: (dryRun: Measured["dryRun"]) => void;
}

const seconds = (from: number, to: number): number => (to - from) / 1000;

/** What the run counts while the import goes. */
interface Tally {
	/** Holds are timed while the import runs, so a start-up write is not taken for the import's. */
	importing: boolean;
	/** The chat whose history is being written: its id from the import's own requests. */
	chat: { historyId: string; startedAt: number; rows: number } | null;
	chats: ChatTiming[];
	firstChatAt: number | null;
	copySeconds: number;
	holds: { seconds: number; rows: number | null }[];
	keyPages: number;
	rowReads: number;
	kept: number;
	refusedWrites: number;
	refusedCommands: number;
}

const refusal = (message: string): { code: string; message: string } => ({
	code: "measure_refused",
	message,
});

/** The only commands the run lets reach a shell: the import's reads, which write nothing. */
function readOnly(command: ShellCommand): boolean {
	const program = command.program.split("/").at(-1);
	if (program === "lsof") return true;
	return program === "git" && command.args.slice(-3).join(" ") === "worktree list --porcelain";
}

const FS_PATH_COMMANDS: ReadonlySet<string> = new Set([
	COMMANDS.fsReadText,
	COMMANDS.fsReadBytes,
	COMMANDS.fsStat,
	COMMANDS.fsReadDir,
	COMMANDS.fsWriteTextAtomic,
	COMMANDS.fsWriteBytesAtomic,
	COMMANDS.fsMkdirp,
	COMMANDS.fsTrash,
]);
const FS_WRITES: ReadonlySet<string> = new Set([
	COMMANDS.fsWriteTextAtomic,
	COMMANDS.fsWriteBytesAtomic,
	COMMANDS.fsMkdirp,
]);
/** Commands that write to a path of their own choosing, outside the file scope. */
const DESTINATION_WRITES: ReadonlySet<string> = new Set([
	COMMANDS.attachmentWriteBytes,
	COMMANDS.attachmentMaterialize,
	COMMANDS.imageResize,
]);

/**
 * The stand-in's commands, fenced to the run's folder: a file written outside it is kept under
 * `<folder>/kept/` at the same path and read back from there; other paths outside are read in
 * place; a shell command other than the import's reads is refused. The two Conductor reads and
 * the copy are counted and timed.
 */
function fenced(bindings: TauriBindings, folder: string, tally: Tally): TauriBindings {
	const keptRoot = join(folder, "kept");
	const inside = (path: string): boolean => path === folder || path.startsWith(`${folder}/`);
	const kept = new Set<string>();
	const isKept = (path: string): boolean => {
		for (const written of kept) if (path === written || path.startsWith(`${written}/`)) return true;
		return false;
	};
	let keptRegistered = false;
	const toKept = async (path: string): Promise<string> => {
		if (!keptRegistered) {
			mkdirSync(keptRoot, { recursive: true });
			await bindings.invoke(COMMANDS.fsRegisterRoot, { path: keptRoot });
			keptRegistered = true;
		}
		const target = join(keptRoot, path);
		mkdirSync(dirname(target), { recursive: true });
		return target;
	};
	const unkept = <T>(answer: T, from: string, to: string): T => {
		if (answer === null || typeof answer !== "object") return answer;
		const swap = (entry: unknown): unknown =>
			typeof entry === "object" && entry !== null && "path" in entry
				? { ...entry, path: String((entry as { path: string }).path).replace(from, to) }
				: entry;
		return (Array.isArray(answer) ? answer.map(swap) : swap(answer)) as T;
	};
	const invoke = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
		// The last call of the container's start tells the Rust shell that the web view handles a
		// quit. The stand-in has no quit to hold, and nothing quits during the run.
		if (command === COMMANDS.setQuitHandlerReady) return undefined as T;
		if (command === COMMANDS.shellRun || command === COMMANDS.shellStart) {
			if (!readOnly(args.command as ShellCommand)) {
				tally.refusedCommands++;
				throw refusal("The measurement runs only the import's read-only commands.");
			}
			return bindings.invoke<T>(command, args);
		}
		if (DESTINATION_WRITES.has(command) && !inside(String(args.destinationPath))) {
			tally.refusedWrites++;
			throw refusal("The measurement writes nothing outside its own folder.");
		}
		if (FS_PATH_COMMANDS.has(command) && typeof args.path === "string" && !inside(args.path)) {
			const path = args.path;
			if (FS_WRITES.has(command)) {
				const target = await toKept(path);
				const answer = await bindings.invoke<T>(command, { ...args, path: target });
				if (!isKept(path)) tally.kept++;
				kept.add(path);
				return answer;
			}
			if (command === COMMANDS.fsTrash) {
				if (!isKept(path)) {
					tally.refusedWrites++;
					throw refusal("The measurement writes nothing outside its own folder.");
				}
				rmSync(join(keptRoot, path), { recursive: true, force: true });
				kept.delete(path);
				return undefined as T;
			}
			if (isKept(path)) {
				const target = join(keptRoot, path);
				return unkept(await bindings.invoke<T>(command, { ...args, path: target }), target, path);
			}
			return bindings.invoke<T>(command, args);
		}
		if (command === COMMANDS.conductorImportCopy) {
			const startedAt = performance.now();
			const copied = await bindings.invoke<T>(command, args);
			tally.copySeconds = seconds(startedAt, performance.now());
			return copied;
		}
		// The dry run reads the chats too, to measure them; only the import's reads are counted.
		if (command === COMMANDS.conductorImportReadMessageKeys) {
			const keys = await bindings.invoke<unknown[]>(command, args);
			if (tally.importing) tally.keyPages++;
			if (tally.chat !== null) tally.chat.rows += keys.length;
			return keys as T;
		}
		if (command === COMMANDS.conductorImportReadMessages && tally.importing) tally.rowReads++;
		return bindings.invoke<T>(command, args);
	};
	return { ...bindings, invoke };
}

/** The raw handle, timed from BEGIN IMMEDIATE to COMMIT or ROLLBACK: how long the queue is held. */
function timedHolds(raw: SqlDatabase, tally: Tally): SqlDatabase {
	let begunAt: number | null = null;
	return {
		select: (sql, params) => raw.select(sql, params),
		execute: async (sql, params) => {
			if (sql === "BEGIN IMMEDIATE") begunAt = performance.now();
			const done = await raw.execute(sql, params);
			if ((sql === "COMMIT" || sql === "ROLLBACK") && begunAt !== null && tally.importing) {
				tally.holds.push({
					seconds: seconds(begunAt, performance.now()),
					rows: tally.chat?.rows ?? null,
				});
				begunAt = null;
			}
			return done;
		},
	};
}

/** The sizes of a database file and its write-ahead log, 0 for a file that is not there. */
function fileBytes(path: string): FileBytes {
	const size = (file: string): number => (existsSync(file) ? statSync(file).size : 0);
	return { database: size(path), journal: size(`${path}-wal`) };
}

/** Opens the scratch Conducted database as `db_open` does: a file, every migration applied. */
function openScratchDatabase(path: string, tally: Tally): SqlDatabase {
	const db = new DatabaseSync(path);
	for (const name of readdirSync(MIGRATIONS)
		.filter((file) => file.endsWith(".sql"))
		.sort()) {
		db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
	}
	return timedHolds(createNodeSqlDatabase(db), tally);
}

interface RealSidecar {
	pid: number;
	socket: Socket;
	stop(): Promise<void>;
}

/**
 * Starts `main.ts sidecar` as the Rust shell does, with every folder inside the run's folder but
 * its socket's, which is short so the socket's path fits.
 */
async function startSidecar(
	folder: string,
	bunPath: string,
	socketFolder: string,
): Promise<RealSidecar> {
	const dir = (name: string): string => {
		const path = join(folder, "sidecar", name);
		mkdirSync(path, { recursive: true });
		return path;
	};
	const child: ChildProcess = spawn(bunPath, [SIDECAR_MAIN, "sidecar"], {
		env: {
			PATH: "/usr/bin:/bin",
			HOME: join(folder, "home"),
			SHELL: "/bin/sh",
			TMPDIR: socketFolder,
			CONDUCTED_BIN_DIR: SIDECAR_BIN,
			CONDUCTED_OUTBOX_ROOT: dir("outbox"),
			CONDUCTED_COMPLETIONS_DIR: dir("completions"),
			CONDUCTED_CURSOR_STORE_DIR: dir("cursor-sdk-store"),
			CONDUCTED_AGENT_BINARIES_DIR: dir("agent-binaries"),
			CONDUCTED_LOG_DIR: dir("log"),
			CONDUCTED_APP_VERSION: "0.0.0",
			CONDUCTED_LOG_LEVEL: "warn",
			CONDUCTED_PARENT_PID: String(process.pid),
		},
		stdio: ["ignore", "pipe", "ignore"],
	});
	const exited = new Promise<void>((done) => child.once("close", () => done()));
	const stop = async (): Promise<void> => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		child.kill("SIGTERM");
		const grace = setTimeout(() => child.kill("SIGKILL"), SIDECAR_STOP_GRACE_MS);
		await exited;
		clearTimeout(grace);
	};
	try {
		const socketPath = await new Promise<string>((found, failed) => {
			let out = "";
			const limit = setTimeout(
				() => failed(new Error("The sidecar did not start.")),
				SIDECAR_START_LIMIT_MS,
			);
			child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
				out += chunk;
				const handshake = /^SOCKET_PATH=(.+)\n/m.exec(out);
				if (handshake?.[1] !== undefined) {
					clearTimeout(limit);
					found(handshake[1]);
				}
			});
			child.once("error", (error) => {
				clearTimeout(limit);
				failed(error);
			});
			void exited.then(() => {
				clearTimeout(limit);
				failed(new Error("The sidecar ended before its handshake."));
			});
		});
		const socket = await new Promise<Socket>((connected, failed) => {
			const opened = createConnection(socketPath);
			opened.once("connect", () => connected(opened));
			opened.once("error", failed);
		});
		if (child.pid === undefined) throw new Error("The sidecar has no pid.");
		return { pid: child.pid, socket, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

/**
 * The stand-in's sidecar is a loopback echo, so the run relays the app's lines to the real sidecar
 * over its socket and back, as the Rust shell's relay does. It also notes where each chat's
 * history starts and ends, from the import's own close requests, which carry no row.
 */
function withRealSidecar(
	bindings: TauriBindings,
	start: () => Promise<RealSidecar>,
	tally: Tally,
): { bindings: TauriBindings; stop: () => Promise<void> } {
	const lineHandlers = new Set<(line: string) => void>();
	const restartHandlers = new Set<() => void>();
	let running: Promise<RealSidecar> | null = null;
	let stopping = false;
	const ensure = (): Promise<RealSidecar> => {
		running ??= start().then((sidecar) => {
			let buffered = "";
			sidecar.socket.setEncoding("utf8");
			sidecar.socket.on("data", (chunk: string) => {
				buffered += chunk;
				const lines = buffered.split("\n");
				buffered = lines.pop() ?? "";
				for (const line of lines) for (const handler of [...lineHandlers]) handler(line);
			});
			sidecar.socket.once("close", () => {
				if (stopping) return;
				running = null;
				for (const handler of [...restartHandlers]) handler();
			});
			return sidecar;
		});
		return running;
	};
	const noteChat = (line: string): void => {
		// A close request is a few dozen characters; a map request holds rows and is never parsed.
		// The dry run's closes, which end its measure of each chat, are not the import's chats.
		if (!tally.importing) return;
		if (line.length > 1024 || !line.includes('"closeConductorHistory"')) return;
		const historyId = String(
			(JSON.parse(line) as { params?: { historyId?: unknown } }).params?.historyId,
		);
		const now = performance.now();
		const open = tally.chat;
		if (open !== null && open.historyId === historyId) {
			tally.chats.push({ rows: open.rows, seconds: seconds(open.startedAt, now) });
			tally.chat = null;
			return;
		}
		tally.firstChatAt ??= now;
		tally.chat = { historyId, startedAt: now, rows: 0 };
	};
	const invoke = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
		if (command === COMMANDS.sidecarEnsureStarted) {
			await ensure();
			return undefined as T;
		}
		if (command === COMMANDS.sidecarSend) {
			const line = String(args.line);
			if (line.includes("\n")) {
				throw { code: "sidecar_bad_line", message: "A sidecar line must not contain a newline." };
			}
			if (running === null) {
				throw { code: "sidecar_not_started", message: "The sidecar has not been started." };
			}
			const { socket } = await running;
			noteChat(line);
			if (!socket.write(`${line}\n`)) {
				await new Promise<void>((drained) => socket.once("drain", () => drained()));
			}
			return undefined as T;
		}
		return bindings.invoke<T>(command, args);
	};
	const listen: TauriBindings["listen"] = async (event, handler) => {
		if (event === EVENTS.sidecarLine) {
			const typed = handler as unknown as (line: string) => void;
			lineHandlers.add(typed);
			return () => {
				lineHandlers.delete(typed);
			};
		}
		if (event === EVENTS.sidecarRestart) {
			const typed = handler as unknown as () => void;
			restartHandlers.add(typed);
			return () => {
				restartHandlers.delete(typed);
			};
		}
		return bindings.listen(event, handler);
	};
	return {
		bindings: { ...bindings, invoke, listen },
		stop: async () => {
			stopping = true;
			const started = running;
			if (started === null) return;
			const sidecar = await started.catch(() => null);
			if (sidecar === null) return;
			sidecar.socket.destroy();
			await sidecar.stop();
		},
	};
}

const sum = (counts: readonly { chats: number; rows: number }[]): { chats: number; rows: number } =>
	counts.reduce(
		(total, count) => ({ chats: total.chats + count.chats, rows: total.rows + count.rows }),
		{
			chats: 0,
			rows: 0,
		},
	);

/** Runs the dry run, the import and the largest chat's first open, and counts. */
export async function measureImport(input: MeasureInput): Promise<Measured> {
	const { folder } = input;
	const tally: Tally = {
		importing: false,
		chat: null,
		chats: [],
		firstChatAt: null,
		copySeconds: 0,
		holds: [],
		keyPages: 0,
		rowReads: 0,
		kept: 0,
		refusedWrites: 0,
		refusedCommands: 0,
	};
	const stage = async <T>(name: Stage, work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof StageFailure) throw error;
			throw new StageFailure(name, error);
		}
	};
	const stand = createNodeTauriBindings(folder);
	// The database commands reach the migrated scratch file, opened on `db_open` as the app opens its
	// own; every other command goes to the stand-in.
	let scratch: SqlDatabase | null = null;
	const database = (): SqlDatabase => {
		scratch ??= openScratchDatabase(join(folder, "conducted.db"), tally);
		return scratch;
	};
	const answerDatabase = databaseCommands(
		{
			execute: (query, values) => database().execute(query, values),
			select: (query, values) => database().select(query, values),
		},
		async () => {
			database();
		},
	);
	const databaseCommandNames = new Set<string>([
		COMMANDS.dbOpen,
		COMMANDS.dbExecute,
		COMMANDS.dbSelect,
	]);
	const relay = withRealSidecar(
		fenced(
			{
				...stand.bindings,
				invoke: <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
					databaseCommandNames.has(command)
						? answerDatabase<T>(command, args)
						: stand.bindings.invoke<T>(command, args),
			},
			folder,
			tally,
		),
		async () => {
			const sidecar = await startSidecar(folder, input.bunPath, input.socketFolder);
			input.onSidecar(sidecar.pid);
			return sidecar;
		},
		tally,
	);
	let stopContainer: (() => Promise<unknown>) | null = null;
	try {
		const platform = await stage("setup", async () => {
			mkdirSync(stand.root, { recursive: true });
			const created = await createTauriPlatform(relay.bindings);
			if (!created.ok) throw new StageFailure("setup", created.error);
			return created.value;
		});
		const container = createContainer({
			platform,
			clock: systemClock,
			ids: cryptoIds,
			toml: tomlCodec,
			placeNames: createPlaceNames(),
			sound: { play: async () => {} },
			windowFocused: () => false,
			reportFailure: () => {},
			showToast: () => {},
			writeDiagnosticsReport: (capture, fileName) =>
				writeRedactedReport(platform, capture, fileName),
		});
		stopContainer = () => container.stop();
		await stage("start", async () => {
			const started = await container.start();
			if (!started.ok) throw new StageFailure("start", started.error);
		});
		const service = container.services.conductorImport;
		input.onStarted();
		const dryRunStarted = performance.now();
		const preview = await stage("dry run", async () => {
			const planned = await service.preview();
			if (!planned.ok) throw new StageFailure("dry run", planned.error);
			return planned.value;
		});
		const history = preview.history;
		const dryRun: Measured["dryRun"] = {
			seconds: seconds(dryRunStarted, performance.now()),
			copySeconds: tally.copySeconds,
			kinds: Object.fromEntries(
				IMPORT_KINDS.map((kind) => [kind, { ...preview.kinds[kind] }]),
			) as Record<ImportKind, KindCount>,
			history: {
				comes: { ...history.comes },
				alreadyThere: { ...history.alreadyThere },
				notMapped: sum(history.notMapped),
				withChatsLeftOut: { ...history.withChatsLeftOut },
			},
			leftOut: preview.leftOut.length,
			files: preview.files.length,
			space: { ...preview.space },
		};
		input.onDryRun(dryRun);
		const scratch = join(folder, "conducted.db");
		const before = fileBytes(scratch);

		const runStarted = performance.now();
		tally.importing = true;
		const outcome = await stage("import", async () => {
			const ran = await service.run();
			if (!ran.ok) throw new StageFailure("import", ran.error);
			return ran.value;
		});
		const runEnded = performance.now();
		tally.importing = false;
		const after = fileBytes(scratch);
		const firstChatAt = tally.firstChatAt ?? runEnded;

		const largest = await stage("open the largest chat", async () => {
			const rows = await platform.db.select<{ session_id: string; n: number }>(
				`SELECT session_id, COUNT(*) AS n FROM session_events
				GROUP BY session_id ORDER BY n DESC LIMIT 1`,
			);
			const top = rows[0];
			if (top === undefined) return null;
			const id = top.session_id as Parameters<typeof container.services.sessions.open>[0];
			const sessions = container.services.sessions;
			const openStarted = performance.now();
			const opened = await sessions.open(id);
			const openEnded = performance.now();
			if (!opened.ok) throw new StageFailure("open the largest chat", opened.error);
			const view = sessions.chatView(id);
			const turnsEnded = performance.now();
			if (view === null) throw new StageFailure("open the largest chat");
			return {
				events: Number(top.n),
				turns: view.turns.length,
				openSeconds: seconds(openStarted, openEnded),
				turnsSeconds: seconds(openEnded, turnsEnded),
			};
		});

		const rowsWrite = tally.holds.find((hold) => hold.rows === null);
		const longest = [...tally.holds].sort((a, b) => b.seconds - a.seconds)[0];
		return {
			dryRun,
			run: {
				seconds: seconds(runStarted, runEnded),
				rowsSeconds: seconds(runStarted, firstChatAt),
				historySeconds: seconds(firstChatAt, runEnded),
				imported: {
					chats: outcome.history.chats,
					changed: outcome.history.changed,
					failed: outcome.history.failed.length,
				},
			},
			chats: {
				timed: tally.chats.length,
				slowest: [...tally.chats].sort((a, b) => b.seconds - a.seconds).slice(0, 5),
			},
			queue: {
				holds: tally.holds.length,
				longestSeconds: longest?.seconds ?? 0,
				longestRows: longest?.rows ?? null,
				rowsWriteSeconds: rowsWrite?.seconds ?? 0,
			},
			largest,
			reads: { keyPages: tally.keyPages, rowReads: tally.rowReads },
			outside: {
				kept: tally.kept,
				refusedWrites: tally.refusedWrites,
				refusedCommands: tally.refusedCommands,
			},
			disk: { before, after },
		};
	} finally {
		await stage("stop", async () => {
			await stopContainer?.();
			await relay.stop();
			await stand.dispose();
		});
	}
}

/** Where the clone of the copy goes, so the import finds it as it finds Conductor's database. */
export const cloneTarget = (folder: string): string => conductorDatabasePath(join(folder, "home"));
