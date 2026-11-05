/**
 * @feature test support Node-backed Tauri bindings for the Platform contract
 * Owns: `createNodeTauriBindings`, a `TauriBindings` whose commands run on Node instead of Rust:
 * files on node:fs, the database on node:sqlite, shell commands as real child processes in their
 * own process group, a loopback echo child as the sidecar, and an in-process event emitter in
 * place of Tauri's event bus. `createTauriPlatform` runs over it unchanged.
 * Behaviour: docs/plans/tauri-commands.md for the command names and payloads; files.rs and
 * shell.rs for what each command promises.
 * Must handle: a command answers as Rust does where the contract looks (an absent path stats as
 * null, a timeout is `shell_timeout`, a cancel is `shell_cancelled`, a send before the sidecar
 * started is `sidecar_not_started`); a command Rust owns and Node cannot do honestly (Trash,
 * pty, keychain, the ignore and regex crates, macOS facts) is not answered, and the contract run
 * skips those cases by name. `dispose` stops every process, closes every database and drops
 * every listener, even when a case failed.
 * Test first: a shell command that outlives its timeout ends with `shell_timeout`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { FileStat, ShellCommand, ShellOutput } from "../platform/platform.ts";
import { COMMANDS, EVENTS, type TauriBindings } from "../platform/tauri.ts";
import { createNodeSqlDatabase } from "./node-sql.ts";
import type { ContractControls } from "./platform-contract.ts";

export interface NodeTauriRun {
	bindings: TauriBindings;
	/** The outside events and read-backs the contract's `controls` cases use. */
	controls: ContractControls;
	/** A folder the cases may write under. */
	root: string;
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

const requirePath = (args: Record<string, unknown> | undefined): string => {
	const path = args?.path;
	if (typeof path !== "string" || !isAbsolute(path)) {
		return fail("fs_relative_path", `${String(path)} is not an absolute path.`);
	}
	return path;
};

/** `dir` is a folder the caller made and removes. Everything the bindings create lives in it. */
export function createNodeTauriBindings(dir: string): NodeTauriRun {
	const root = join(dir, "root");
	const paths = {
		home: join(dir, "home"),
		appData: join(dir, "app-data"),
		temp: join(dir, "temp"),
		resources: join(dir, "resources"),
	};
	const events = createEmitter();
	const windowEvents = createEmitter();
	const databases: DatabaseSync[] = [];
	const running = new Map<string, RunningProcess>();
	let sidecar: ChildProcess | null = null;
	let disposed = false;
	let focused = true;
	let tempCounter = 0;
	let dockBadge: number | null = null;
	let clipboardText: string | null = null;
	const pendingClicks: string[] = [];
	const folderAnswers: (string | null)[] = [];
	const fileAnswers: string[][] = [];
	const confirmAnswers: boolean[] = [];

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

	const writeAtomic = async (path: string, text: string): Promise<void> => {
		const temp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${++tempCounter}`);
		try {
			await writeFile(temp, text, "utf8");
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
			case COMMANDS.fsPaths:
				return paths;
			case COMMANDS.logWrite:
				return undefined;
			case COMMANDS.fsReadText:
				return readFile(requirePath(args), "utf8").catch((error: Error) =>
					fail("fs_io", error.message),
				);
			case COMMANDS.fsWriteTextAtomic:
				return writeAtomic(requirePath(args), String(args.text));
			case COMMANDS.fsStat:
				return statOf(requirePath(args));
			case COMMANDS.fsMkdirp:
				await mkdir(requirePath(args), { recursive: true }).catch((error: Error) =>
					fail("fs_io", error.message),
				);
				return undefined;
			case COMMANDS.fsReadDir: {
				const folder = requirePath(args);
				const names = await readdir(folder).catch((error: Error) => fail("fs_io", error.message));
				const entries = await Promise.all(names.map((name) => statOf(join(folder, name))));
				return entries.filter((entry): entry is FileStat => entry !== null);
			}
			case COMMANDS.shellLoginEnv:
				return { shell: process.env.SHELL ?? "/bin/sh", path: process.env.PATH ?? "" };
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
				const child = sidecar;
				if (child === null || child.stdin === null) {
					return fail("sidecar_not_started", "The sidecar has not been started.");
				}
				const stdin = child.stdin;
				await new Promise<void>((resolve, reject) => {
					stdin.write(`${String(args.line)}\n`, (error) => (error ? reject(error) : resolve()));
				});
				return undefined;
			}
			case COMMANDS.setDockBadge:
				dockBadge = (args.count as number | null) ?? null;
				return undefined;
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
		window: {
			isFocused: async () => focused,
			listen: windowEvents.listen,
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
		get dockBadge() {
			return dockBadge;
		},
		get clipboardText() {
			return clipboardText;
		},
	};

	return {
		bindings,
		controls,
		root,
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
