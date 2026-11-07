/**
 * @feature test support Node-backed Tauri bindings for the Platform contract
 * Owns: `createNodeTauriBindings`, a `TauriBindings` whose commands run on Node instead of Rust:
 * files on node:fs, the database on node:sqlite, shell commands as real child processes in their
 * own process group, a loopback echo child as the sidecar, an in-process event emitter in
 * place of Tauri's event bus, and the import's copies of a Conductor database made from its bytes
 * and read back with node:sqlite (APP-17). `createTauriPlatform` runs over it unchanged.
 * Behaviour: docs/plans/tauri-commands.md for the command names and payloads; files.rs and
 * shell.rs for what each command promises.
 * Must handle: a command answers as Rust does where the contract looks (an absent path stats as
 * null, a timeout is `shell_timeout`, a cancel is `shell_cancelled`, a send before the sidecar
 * started is `sidecar_not_started`, a file path outside the default roots and the registered ones is
 * `fs_out_of_scope`); a command Rust owns and Node cannot do honestly (Trash,
 * pty, keychain, the ignore and regex crates, macOS facts) is not answered, and the contract run
 * skips those cases by name. `dispose` stops every process, closes every database and drops
 * every listener, even when a case failed.
 * Test first: a shell command that outlives its timeout ends with `shell_timeout`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { assetUrlOf, defaultFileRoots, isWithinRoot } from "../platform/memory.ts";
import {
	CONDUCTOR_COPY_FOLDER,
	CONDUCTOR_COUNTED_TABLES,
	CONDUCTOR_READ_TABLES,
	type FileStat,
	type ProgramStatus,
	type ShellCommand,
	type ShellOutput,
} from "../platform/platform.ts";
import { COMMANDS, EVENTS, type TauriBindings } from "../platform/tauri.ts";
import { createNodeSqlDatabase } from "./node-sql.ts";
import type { ContractControls } from "./platform-contract.ts";

export interface NodeTauriRun {
	bindings: TauriBindings;
	/** The outside events and read-backs the contract's `controls` cases use. */
	controls: ContractControls;
	/** A folder the cases may write under: the default workspaces folder, inside the file scope. */
	root: string;
	/** A folder outside the default file scope. */
	outside: string;
	/** Stops every process, closes every database, drops every listener. Safe to call twice. */
	dispose(): Promise<void>;
}

/** What a Rust command rejects with. `toAppError` reads it. */
class CommandFailure extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

const fail = (code: string, message: string): never => {
	throw new CommandFailure(code, message);
};

/** Child that echoes every byte of stdin to stdout: the loopback stand-in for the sidecar. */
const ECHO_PROGRAM = "process.stdin.pipe(process.stdout)";

const GRACE_MS = 2_000;

interface Emitter {
	listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>;
	emit(event: string, payload: unknown): void;
	clear(): void;
}

function createEmitter(): Emitter {
	const handlers = new Map<string, Set<(payload: never) => void>>();
	return {
		listen: async <T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> => {
			const set = handlers.get(event) ?? new Set();
			handlers.set(event, set);
			set.add(handler as (payload: never) => void);
			return () => {
				set.delete(handler as (payload: never) => void);
			};
		},
		emit: (event, payload) => {
			for (const handler of [...(handlers.get(event) ?? [])]) handler(payload as never);
		},
		clear: () => handlers.clear(),
	};
}

type Ended = { kind: "exit"; output: ShellOutput } | { kind: "timeout" } | { kind: "cancelled" };

interface RunningProcess {
	child: ChildProcess;
	cancelled: boolean;
	ended: Promise<Ended>;
	/** SIGTERM to the whole process group, then SIGKILL if it is still there after the grace. */
	killGroup(): void;
}

function launch(command: ShellCommand): Promise<RunningProcess> {
	return new Promise((resolve, reject) => {
		const child = spawn(command.program, [...command.args], {
			cwd: command.cwd,
			env: { ...process.env, ...command.env },
			detached: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
			// The program may end before it reads its input. Any other write error is real.
			if (error.code !== "EPIPE") throw error;
		});
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		const signalGroup = (signal: NodeJS.Signals): void => {
			if (child.pid === undefined) return;
			try {
				process.kill(-child.pid, signal);
			} catch (error) {
				// The group is already gone.
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		};
		const running: RunningProcess = {
			child,
			cancelled: false,
			killGroup: () => {
				signalGroup("SIGTERM");
				killTimer ??= setTimeout(() => signalGroup("SIGKILL"), GRACE_MS);
			},
			ended: new Promise<Ended>((done) => {
				child.once("close", (code, signal) => {
					if (killTimer !== undefined) clearTimeout(killTimer);
					if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
					if (running.cancelled) return done({ kind: "cancelled" });
					if (timedOut) return done({ kind: "timeout" });
					const exitCode = code ?? 128 + (signal === null ? 0 : (osConstants.signals[signal] ?? 0));
					done({ kind: "exit", output: { exitCode, stdout, stderr } });
				});
			}),
		};
		if (command.timeoutMs !== undefined) {
			timeoutTimer = setTimeout(() => {
				timedOut = true;
				running.killGroup();
			}, command.timeoutMs);
		}
		child.once("error", (error) => {
			if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
			reject(new CommandFailure("shell_spawn_failed", error.message));
		});
		child.once("spawn", () => resolve(running));
		child.stdin?.end(command.stdin ?? "");
	});
}

async function statOf(path: string): Promise<FileStat | null> {
	try {
		const link = await lstat(path);
		const target = link.isSymbolicLink() ? await stat(path).catch(() => null) : link;
		return {
			path,
			isDirectory: target?.isDirectory() ?? false,
			isSymlink: link.isSymbolicLink(),
			size: target === null || target.isDirectory() ? 0 : target.size,
			modifiedAt: Math.round((target ?? link).mtimeMs),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new CommandFailure("fs_io", (error as Error).message);
	}
}

/** A missing file or folder is `fs_not_found`, as files.rs answers it; other failures are `fs_io`. */
const fsFailure = (error: Error, path: string): never => {
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "ENOENT" || code === "ENOTDIR") {
		return fail("fs_not_found", `${path} does not exist.`);
	}
	return fail("fs_io", error.message);
};

const requirePath = (args: Record<string, unknown> | undefined): string => {
	const path = args?.path;
	if (typeof path !== "string" || !isAbsolute(path)) {
		return fail("fs_relative_path", `${String(path)} is not an absolute path.`);
	}
	return path;
};

/** The files.rs scope check over the default roots and the registered ones. */
const requireInScope = (path: string, roots: readonly string[]): string => {
	if (roots.some((root) => isWithinRoot(path, root))) return path;
	return fail("fs_out_of_scope", `Path is outside the folders this window may reach: ${path}`);
};

/** Size and modified time of a file, or null when it is not there. */
async function fileFacts(path: string): Promise<[number, number] | null> {
	const found = await stat(path).catch(() => null);
	return found === null ? null : [found.size, found.mtimeMs];
}

const SIDE_FILES = ["", "-wal", "-journal"] as const;

/** conductor_import.rs `copy_database`: bytes in, three tries, then the copy opened and settled. */
async function copyConductorDatabase(source: string, folder: string): Promise<unknown> {
	const found = isAbsolute(source) ? await stat(source).catch(() => null) : null;
	if (found?.isFile() !== true) {
		return fail("conductor_import_missing", `Conductor's database was not found at ${source}.`);
	}
	await mkdir(folder, { recursive: true });
	for (let attempt = 0; attempt < 3; attempt++) {
		const destination = join(folder, `conductor-${Date.now()}-${process.pid}-${attempt}.db`);
		const before = await Promise.all(SIDE_FILES.map((side) => fileFacts(`${source}${side}`)));
		for (const [index, side] of SIDE_FILES.entries()) {
			if (before[index] !== null) await copyFile(`${source}${side}`, `${destination}${side}`);
		}
		const after = await Promise.all(SIDE_FILES.map((side) => fileFacts(`${source}${side}`)));
		if (JSON.stringify(before) !== JSON.stringify(after)) {
			for (const side of [...SIDE_FILES, "-shm"])
				await rm(`${destination}${side}`, { force: true });
			continue;
		}
		try {
			const db = new DatabaseSync(destination);
			db.exec("PRAGMA journal_mode = DELETE");
			db.close();
		} catch (error) {
			for (const side of [...SIDE_FILES, "-shm"])
				await rm(`${destination}${side}`, { force: true });
			return fail("conductor_import_copy_failed", (error as Error).message);
		}
		return { copyPath: destination, bytes: (await stat(destination)).size };
	}
	return fail(
		"conductor_import_busy",
		"Conductor kept writing to its database while it was copied.",
	);
}

/** conductor_import.rs `read_snapshot`, for a copy directly inside the import's folder. */
async function readConductorCopy(
	copyPath: string,
	folder: string,
	databases: DatabaseSync[],
): Promise<unknown> {
	const found = await stat(copyPath).catch(() => null);
	if (dirname(copyPath) !== folder || found?.isFile() !== true) {
		return fail("conductor_import_bad_copy", `${copyPath} is not a copy this import made.`);
	}
	const db = new DatabaseSync(copyPath, { readOnly: true });
	databases.push(db);
	const exists = (table: string): boolean =>
		db
			.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
			.get(table)?.n !== 0;
	const tables: Record<string, unknown> = {};
	for (const table of CONDUCTOR_READ_TABLES) {
		if (!exists(table)) {
			tables[table] = null;
			continue;
		}
		tables[table] =
			table === "env_vars"
				? db
						.prepare("SELECT key, scope, context, value IS NOT NULL AS has_value FROM env_vars")
						.all()
						.map((row) => ({ ...row, has_value: row.has_value !== 0 }))
				: db
						.prepare(`SELECT * FROM "${table}"`)
						.all()
						.map((row) => ({ ...row }));
	}
	const counts: Record<string, unknown> = {};
	for (const table of CONDUCTOR_COUNTED_TABLES) {
		counts[table] = exists(table)
			? Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()?.n)
			: null;
	}
	return { tables, counts };
}

/** `dir` is a folder the caller made and removes. Everything the bindings create lives in it. */
export function createNodeTauriBindings(dir: string): NodeTauriRun {
	const paths = {
		home: join(dir, "home"),
		appData: join(dir, "app-data"),
		temp: join(dir, "temp"),
		resources: join(dir, "resources"),
	};
	const root = join(paths.home, "conducted");
	const conductorFolder = join(paths.appData, CONDUCTOR_COPY_FOLDER);
	const outside = join(dir, "outside");
	const registeredRoots: string[] = [];
	const scopedPath = (args: Record<string, unknown> | undefined): string =>
		requireInScope(requirePath(args), [...defaultFileRoots(paths), ...registeredRoots]);
	const events = createEmitter();
	const windowEvents = createEmitter();
	const databases: DatabaseSync[] = [];
	const running = new Map<string, RunningProcess>();
	let sidecar: ChildProcess | null = null;
	let disposed = false;
	let focused = true;
	let networkOnline = true;
	let tempCounter = 0;
	let dockBadge: number | null = null;
	let clipboardText: string | null = null;
	let clipboardFilePaths: string[] = [];
	const pendingClicks: string[] = [];
	const folderAnswers: (string | null)[] = [];
	const fileAnswers: string[][] = [];
	const confirmAnswers: boolean[] = [];
	const programStatuses = new Map<string, ProgramStatus>();

	const statusFor = (program: string): ProgramStatus =>
		programStatuses.get(program) ?? {
			program: program as ProgramStatus["program"],
			state: "missing",
			version: null,
			bytesDownloaded: 0,
			bytesTotal: null,
			attempt: 0,
			nextAttemptAt: null,
			error: null,
			path: null,
		};

	const setProgramStatus = (status: ProgramStatus): void => {
		programStatuses.set(status.program, status);
		events.emit(EVENTS.programsStatus, status);
	};

	const startSidecar = (): Promise<void> =>
		new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ["-e", ECHO_PROGRAM], {
				stdio: ["pipe", "pipe", "ignore"],
			});
			let buffered = "";
			child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
				buffered += chunk;
				const lines = buffered.split("\n");
				buffered = lines.pop() ?? "";
				for (const line of lines) events.emit(EVENTS.sidecarLine, line);
			});
			child.once("close", () => {
				if (sidecar === child) sidecar = null;
				if (!disposed) events.emit(EVENTS.sidecarRestart, undefined);
			});
			child.once("error", (error) =>
				reject(new CommandFailure("sidecar_spawn_failed", error.message)),
			);
			child.once("spawn", () => {
				sidecar = child;
				resolve();
			});
		});

	const writeAtomic = async (path: string, data: string | Uint8Array): Promise<void> => {
		const temp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${++tempCounter}`);
		try {
			await (typeof data === "string" ? writeFile(temp, data, "utf8") : writeFile(temp, data));
			await rename(temp, path);
		} catch (error) {
			await rm(temp, { force: true });
			throw new CommandFailure("fs_io", (error as Error).message);
		}
	};

	const invoke = async (command: string, args: Record<string, unknown> = {}): Promise<unknown> => {
		switch (command) {
			case COMMANDS.health:
				return "ok";
			case COMMANDS.appInfo:
				return { version: "0.0.0-contract", channel: "dev" };
			case COMMANDS.networkStatus:
				return networkOnline;
			case COMMANDS.fullDiskAccessCheck:
				return true;
			case COMMANDS.fullDiskAccessOpenSettings:
				return undefined;
			case COMMANDS.fsPaths:
				return paths;
			case COMMANDS.logWrite:
				return undefined;
			case COMMANDS.httpFetch: {
				const request = args.request as { url?: unknown } | undefined;
				const requested = request?.url;
				if (typeof requested !== "string") {
					return fail("http_invalid_url", "The request has no URL.");
				}
				try {
					new URL(requested);
				} catch {
					return fail("http_invalid_url", `The URL is not valid: ${requested}`);
				}
				return fail("http_offline", "The Node-backed contract bindings make no network requests.");
			}
			case COMMANDS.fsReadText: {
				const requested = scopedPath(args);
				return readFile(requested, "utf8").catch((error: Error) => fsFailure(error, requested));
			}
			case COMMANDS.fsWriteTextAtomic:
				return writeAtomic(scopedPath(args), String(args.text));
			// CLOUD-11's byte door, as files.rs answers it: base64 both ways, and a body that is not
			// base64 refused as fs_bad_data.
			case COMMANDS.fsReadBytes: {
				const requested = scopedPath(args);
				return readFile(requested)
					.then((bytes) => bytes.toString("base64"))
					.catch((error: Error) => fsFailure(error, requested));
			}
			case COMMANDS.fsWriteBytesAtomic: {
				const data = String(args.data);
				if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
					fail("fs_bad_data", "The file's bytes are not base64.");
				}
				return writeAtomic(scopedPath(args), Buffer.from(data, "base64"));
			}
			case COMMANDS.fsStat:
				return statOf(scopedPath(args));
			case COMMANDS.fsMkdirp:
				await mkdir(scopedPath(args), { recursive: true }).catch((error: Error) =>
					fail("fs_io", error.message),
				);
				return undefined;
			case COMMANDS.fsRegisterRoot: {
				const folder = requirePath(args);
				if (!registeredRoots.includes(folder)) registeredRoots.push(folder);
				return undefined;
			}
			case COMMANDS.fsReadDir: {
				const folder = scopedPath(args);
				const names = await readdir(folder).catch((error: Error) => fsFailure(error, folder));
				const entries = await Promise.all(names.map((name) => statOf(join(folder, name))));
				return entries.filter((entry): entry is FileStat => entry !== null);
			}
			case COMMANDS.attachmentWriteBytes: {
				const destination = String(args.destinationPath);
				const bytes = Buffer.from(String(args.data), "base64");
				await writeAtomic(destination, bytes.toString("utf8"));
				return {
					path: destination,
					sizeBytes: bytes.length,
					isImage: false,
					width: null,
					height: null,
					resized: false,
				};
			}
			case COMMANDS.deepLinkLaunch:
				return { urls: [], rejected: [] };
			case COMMANDS.clipboardReadFilePaths:
				return [...clipboardFilePaths];
			case COMMANDS.attachmentMaterialize:
			case COMMANDS.imageResize: {
				const source = String(args.sourcePath);
				const destination = String(args.destinationPath);
				const text = await readFile(source, "utf8").catch((error: Error) =>
					fail("attachment_missing", error.message),
				);
				await writeAtomic(destination, text);
				return {
					path: destination,
					sizeBytes: Buffer.byteLength(text),
					isImage: false,
					width: null,
					height: null,
					resized: false,
				};
			}
			case COMMANDS.menuSetShortcuts: {
				const shortcuts =
					(args.shortcuts as { commandId: string; accelerator: string | null }[] | undefined) ?? [];
				return { applied: shortcuts.map((shortcut) => shortcut.commandId), rejected: [] };
			}
			case COMMANDS.windowSetVibrancy:
				if (typeof args.enabled !== "boolean") {
					return fail("window_vibrancy_invalid", "window_set_vibrancy needs a boolean enabled.");
				}
				return undefined;
			case COMMANDS.windowSetTrafficLights:
				if (typeof args.x !== "number" || typeof args.y !== "number") {
					return fail("traffic_lights_invalid", "window_set_traffic_lights needs an x and a y.");
				}
				return undefined;
			case COMMANDS.shellLoginEnv: {
				const cwd = args.cwd;
				if (typeof cwd === "string" && !isAbsolute(cwd)) {
					return fail("shell_bad_cwd", `The working folder must be an absolute path: ${cwd}`);
				}
				const zdotdir = process.env.ZDOTDIR;
				return {
					shell: process.env.SHELL ?? "/bin/sh",
					path: process.env.PATH ?? "",
					zdotdir: zdotdir === undefined || zdotdir === "" ? null : zdotdir,
				};
			}
			case COMMANDS.shellRun: {
				const process_ = await launch(args.command as ShellCommand);
				const ended = await process_.ended;
				if (ended.kind === "timeout") {
					return fail("shell_timeout", "The command was stopped after its timeout.");
				}
				if (ended.kind === "cancelled")
					return fail("shell_cancelled", "The command was cancelled.");
				return ended.output;
			}
			case COMMANDS.shellStart: {
				const id = String(args.id);
				if (running.has(id)) return fail("shell_duplicate_id", `${id} is already running.`);
				const started = await launch(args.command as ShellCommand);
				running.set(id, started);
				void started.ended.then((ended) => {
					running.delete(id);
					if (disposed) return;
					const error =
						ended.kind === "timeout"
							? { code: "shell_timeout", message: "The command was stopped after its timeout." }
							: ended.kind === "cancelled"
								? { code: "shell_cancelled", message: "The command was cancelled." }
								: null;
					events.emit(EVENTS.shellDone, {
						id,
						output: ended.kind === "exit" ? ended.output : null,
						error,
					});
				});
				return undefined;
			}
			case COMMANDS.shellCancel: {
				const target = running.get(String(args.id));
				if (target !== undefined) {
					target.cancelled = true;
					target.killGroup();
				}
				return undefined;
			}
			case COMMANDS.sidecarEnsureStarted:
				if (sidecar === null) await startSidecar();
				return undefined;
			case COMMANDS.sidecarSend: {
				// As sidecar_send does, first: the newline that ends the line is added below.
				const line = String(args.line);
				if (line.includes("\n") || line.includes("\r")) {
					return fail("sidecar_bad_line", "A sidecar line must not contain a newline.");
				}
				const child = sidecar;
				if (child === null || child.stdin === null) {
					return fail("sidecar_not_started", "The sidecar has not been started.");
				}
				const stdin = child.stdin;
				await new Promise<void>((resolve, reject) => {
					stdin.write(`${line}\n`, (error) => (error ? reject(error) : resolve()));
				});
				return undefined;
			}
			case COMMANDS.programsState:
				return [...programStatuses.values()];
			case COMMANDS.programInstall:
			case COMMANDS.programRedownload: {
				const program = String(args.program);
				setProgramStatus({
					...statusFor(program),
					state: "ready",
					version: "contract",
					path: join(paths.appData, "agent-binaries", program, "contract", program),
				});
				return undefined;
			}
			case COMMANDS.programRemove: {
				const program = String(args.program);
				setProgramStatus({
					...statusFor(program),
					state: "missing",
					version: null,
					path: null,
				});
				return undefined;
			}
			case COMMANDS.programsPrefetch:
				return undefined;
			case COMMANDS.setDockBadge:
				dockBadge = (args.count as number | null) ?? null;
				return undefined;
			// APP-17, as conductor_import.rs answers: Conductor's files are read as bytes, only the
			// copy is opened, and only a copy in the import's folder can be read.
			case COMMANDS.conductorImportFind: {
				const source = String(args.source);
				if (!isAbsolute(source)) return null;
				const found = await stat(source).catch(() => null);
				return found?.isFile() === true ? found.size : null;
			}
			case COMMANDS.conductorImportCopy:
				return copyConductorDatabase(String(args.source), conductorFolder);
			case COMMANDS.conductorImportRead:
				return readConductorCopy(String(args.copyPath), conductorFolder, databases);
			case COMMANDS.conductorImportDiscard: {
				const names = await readdir(conductorFolder).catch(() => [] as string[]);
				for (const name of names) await rm(join(conductorFolder, name), { force: true });
				return names.length;
			}
			case COMMANDS.notificationTakePending: {
				// Rust keeps the newest queued click and drops older ones.
				const newest = pendingClicks.at(-1);
				pendingClicks.length = 0;
				return newest === undefined ? [] : [newest];
			}
			default:
				return fail("unknown_command", `The Node bindings do not answer ${command}.`);
		}
	};

	const bindings: TauriBindings = {
		invoke: (command, args) => invoke(command, args) as Promise<never>,
		listen: events.listen,
		assetUrl: assetUrlOf,
		window: {
			isFocused: async () => focused,
			listen: windowEvents.listen,
			onDragDropEvent: async () => () => {},
			setTheme: async (_theme) => {},
		},
		webview: {
			setZoom: async (_factor) => {},
		},
		sql: {
			load: async () => {
				const db = new DatabaseSync(":memory:");
				databases.push(db);
				return createNodeSqlDatabase(db);
			},
		},
		dialog: {
			open: async (options) => {
				if (options.directory === true) return folderAnswers.shift() ?? null;
				const files = fileAnswers.shift() ?? [];
				if (files.length === 0) return null;
				// The plugin answers a list when `multiple` is set and one path otherwise.
				return options.multiple === true ? files : (files[0] ?? null);
			},
			save: async () => null,
			ask: async () => confirmAnswers.shift() ?? false,
		},
		clipboard: {
			writeText: async (text) => {
				clipboardText = text;
			},
			writeImage: async () => fail("clipboard_unavailable", "Node has no image clipboard."),
		},
	};

	const controls: ContractControls = {
		queueDialogAnswers: (answers) => {
			if (answers.folder !== undefined) folderAnswers.push(answers.folder);
			if (answers.files !== undefined) fileAnswers.push(answers.files);
			if (answers.confirm !== undefined) confirmAnswers.push(answers.confirm);
		},
		// A restart is the sidecar process ending, so the control ends it and waits for the event.
		emitSidecarRestart: async () => {
			const child = sidecar;
			if (child === null) throw new Error("The loopback sidecar is not running.");
			const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
			child.kill("SIGKILL");
			await closed;
		},
		emitNotificationClick: (deepLink) => {
			pendingClicks.push(deepLink);
			events.emit(EVENTS.notificationClicked, undefined);
		},
		emitWindowFocus: (next) => {
			focused = next;
			windowEvents.emit(next ? EVENTS.windowFocus : EVENTS.windowBlur, undefined);
		},
		emitNetworkChanged: (online) => {
			networkOnline = online;
			events.emit(EVENTS.networkChanged, online);
		},
		emitDeepLinkRejected: (rejection) => {
			events.emit(EVENTS.deepLinkRejected, rejection);
		},
		get dockBadge() {
			return dockBadge;
		},
		get clipboardText() {
			return clipboardText;
		},
		setClipboardFilePaths: (paths) => {
			clipboardFilePaths = [...paths];
		},
		seedConductorDatabase: async (path, tables) => {
			await mkdir(dirname(path), { recursive: true });
			const db = new DatabaseSync(path);
			try {
				db.exec("PRAGMA journal_mode = WAL");
				for (const [table, rows] of Object.entries(tables)) {
					const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
					db.exec(`CREATE TABLE "${table}" (${columns.map((name) => `"${name}"`).join(", ")})`);
					const insert = db.prepare(
						`INSERT INTO "${table}" (${columns.map((name) => `"${name}"`).join(", ")})
						VALUES (${columns.map(() => "?").join(", ")})`,
					);
					for (const row of rows) {
						insert.run(...columns.map((name) => (row[name] ?? null) as SQLInputValue));
					}
				}
			} finally {
				db.close();
			}
		},
		conductorFingerprint: async (path) => {
			const folder = dirname(path);
			const names = (await readdir(folder)).sort();
			const entries = await Promise.all(
				names.map(async (name) => {
					const file = join(folder, name);
					const facts = await stat(file);
					const bytes = facts.isFile() ? await readFile(file) : Buffer.alloc(0);
					return [
						name,
						facts.size,
						facts.mtimeMs,
						createHash("sha256").update(bytes).digest("hex"),
					];
				}),
			);
			return JSON.stringify(entries);
		},
	};

	return {
		bindings,
		controls,
		root,
		outside,
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			const ending: Promise<unknown>[] = [];
			for (const process_ of running.values()) {
				process_.cancelled = true;
				process_.killGroup();
				ending.push(process_.ended);
			}
			const child = sidecar;
			if (child !== null) {
				ending.push(new Promise<void>((resolve) => child.once("close", () => resolve())));
				child.kill("SIGKILL");
			}
			await Promise.all(ending);
			for (const db of databases) db.close();
			events.clear();
			windowEvents.clear();
		},
	};
}
