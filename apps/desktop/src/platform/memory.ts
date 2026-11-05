/**
 * @feature PLAT-01 In-memory Platform for tests
 * Owns: a complete `Platform` that keeps everything in memory, plus handles ("controls") that let
 * a test script what the outside world does: shell answers, sidecar lines, clicks, deep links and
 * window focus.
 * Behaviour: services-map.md 1.1 (the Platform object is the only boundary, so a stand-in is
 * possible); docs/plans/scaffold.md decision on tests that "never mock what they test".
 * Must handle: it passes the Platform contract (contract.ts), the same list the Tauri implementation
 * must pass once the planned end-to-end job runs it (docs/plans/parallel-build.md). Until then the
 * contract proves the stand-in alone, so a service test on it describes the stand-in's behaviour.
 * Time and ids come from the options, never from globals; every listener it hands out can be
 * removed, and `dispose()` returns the number still attached so a test can assert that none leaked;
 * the database is a real SQLite passed in by the test (for example a thin adapter over
 * `node:sqlite`), because a fake database would test the fake; the shell answers only what a test
 * scripted, and an unscripted command is an `Err` with code `shell_unscripted`, never a made-up
 * success; a cancelled `shell.start` ends with Err `shell_cancelled`, as shell.rs reports it; a
 * queued dialog answer is used only by the dialog kind it was queued for; an unreadable
 * `listArtifacts` cursor is an Err; `app.writeLog` keeps the level and message, not the data; the
 * file system keeps text only, with folders as path prefixes.
 * Our design choice: the stand-in is a factory returning the Platform together with its controls,
 * so production code cannot reach the controls through the Platform type.
 * Test first: the contract case "fs: write then read returns the same text" passes on it.
 */

import type { Clock, IdSource, ManagedProgram } from "@conducted/shared";
import { appError, err, ok, type Result } from "@conducted/shared";
import { globToRegExp } from "./glob.ts";
import type {
	AppInfo,
	AppMenu,
	AppWindow,
	AttachmentFiles,
	Clipboard,
	Database,
	Dialogs,
	FileDropEvent,
	FileSearch,
	FileStat,
	FileSystem,
	Http,
	Keychain,
	MaterializedFile,
	Notifications,
	Opener,
	Platform,
	ProgramStatus,
	Programs,
	Pty,
	PtyHandle,
	RunningCommand,
	ScreenSnapshot,
	Shell,
	ShellCommand,
	ShellOutput,
	SidecarTransport,
	Speech,
	SpeechEvent,
	SystemFacts,
	TreeEntry,
	Unsubscribe,
	Updater,
} from "./platform.ts";

/** A scripted answer for a shell command. Return null when the script does not know the command. */
export type ShellScript = (command: ShellCommand) => Result<ShellOutput> | null;

export interface MemoryPlatformOptions {
	clock: Clock;
	ids: IdSource;
	/** A real SQLite handle, already migrated by the test. */
	database: Database;
	version?: string;
	channel?: "dev" | "release";
	home?: string;
	appData?: string;
	temp?: string;
	resources?: string;
}

export interface MemoryPlatformControls {
	/** Replaces the shell script. Later scripts are tried first. */
	scriptShell(script: ShellScript): void;
	/** Makes the next `shell.start` stay running until the caller cancels it. */
	holdNextStart(): void;
	/** The exit code of the next PTY spawned with a `command`. Null means a signal ended it. */
	queuePtyExit(code: number | null): void;
	/** Every command given to `shell.run` and `shell.start`, in order. */
	readonly shellCalls: readonly ShellCommand[];
	/** Text files by absolute path. Reading and writing through `fs` use this map. */
	readonly files: Map<string, string>;
	/** Lines the app sent to the sidecar, in order. */
	readonly sidecarSent: readonly string[];
	/** Delivers a line to `sidecar.onLine` listeners. */
	emitSidecarLine(line: string): void;
	emitSidecarRestart(): void;
	/** Delivers a notification click and a deep link. */
	emitNotificationClick(deepLink: string): void;
	emitDeepLink(url: string): void;
	emitQuitRequested(): void;
	/** Changes the window's focus and tells every focus listener. */
	emitWindowFocus(focused: boolean): void;
	/** Notifications shown and the last dock badge. */
	readonly notificationsShown: readonly { title: string; body: string; deepLink?: string }[];
	readonly dockBadge: number | null;
	/** The last text written to the clipboard. */
	readonly clipboardText: string | null;
	/** Answers for dialogs, consumed in order. */
	queueDialogAnswers(answers: {
		folder?: string | null;
		files?: string[];
		confirm?: boolean;
	}): void;
	/** Secrets by key. */
	readonly secrets: Map<string, string>;
	/** Log lines written through `app.writeLog`. */
	readonly logs: readonly { level: string; message: string }[];
	/** Returns the number of listeners handed out by the Platform that were never unsubscribed. */
	dispose(): number;
}

export interface MemoryPlatform {
	platform: Platform;
	controls: MemoryPlatformControls;
}

// ---------------------------------------------------------------- paths

const normalizePath = (path: string): string => {
	const trimmed = path.replace(/\/+/g, "/").replace(/\/$/, "");
	return trimmed === "" ? "/" : trimmed;
};

const parentPath = (path: string): string => {
	const normalized = normalizePath(path);
	const at = normalized.lastIndexOf("/");
	return at <= 0 ? "/" : normalized.slice(0, at);
};

const baseName = (path: string): string => {
	const normalized = normalizePath(path);
	return normalized.slice(normalized.lastIndexOf("/") + 1);
};

const pathParts = (path: string): string[] =>
	normalizePath(path)
		.split("/")
		.filter((part) => part !== "");

/** Every folder above `path`, outermost first, never the path itself. */
const ancestors = (path: string): string[] => {
	const parts = pathParts(path);
	const result: string[] = [];
	let current = "";
	for (const part of parts.slice(0, -1)) {
		current += `/${part}`;
		result.push(current);
	}
	return result;
};

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");

const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, "");

interface IgnoreRule {
	pattern: RegExp;
	hasSlash: boolean;
}

/** A small gitignore reader: literals, `*`, `**` and `?`, matched per path segment. */
const ignoreRulesFor = (root: string, files: ReadonlyMap<string, string>): IgnoreRule[] => {
	const text = files.get(`${normalizePath(root)}/.gitignore`);
	if (text === undefined) return [];
	const rules: IgnoreRule[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
		const pattern = line.endsWith("/") ? line.slice(0, -1) : line;
		if (pattern === "") continue;
		rules.push({ pattern: globToRegExp(pattern), hasSlash: pattern.includes("/") });
	}
	return rules;
};

const isIgnoredPath = (relative: string, rules: readonly IgnoreRule[]): boolean => {
	const segments = relative.split("/").filter((part) => part !== "");
	if (segments.includes(".git")) return true;
	for (const rule of rules) {
		if (rule.hasSlash) {
			if (rule.pattern.test(relative)) return true;
			for (let index = 1; index < segments.length; index++) {
				if (rule.pattern.test(segments.slice(0, index).join("/"))) return true;
			}
		} else if (segments.some((segment) => rule.pattern.test(segment))) {
			return true;
		}
	}
	return false;
};

const fuzzyScore = (path: string, query: string): number => {
	const haystack = path.toLowerCase();
	const needle = query.toLowerCase();
	if (needle === "") return 0;
	let found = 0;
	let score = 0;
	let streak = 0;
	for (let index = 0; index < haystack.length && found < needle.length; index++) {
		if (haystack.charAt(index) === needle.charAt(found)) {
			streak++;
			score += streak * 2 + (index === 0 ? 5 : 0);
			found++;
		} else {
			streak = 0;
		}
	}
	if (found < needle.length) return -1;
	const name = baseName(path).toLowerCase();
	if (name.startsWith(needle)) score += 100;
	else if (name.includes(needle)) score += 30;
	return score - haystack.length * 0.01;
};

// ---------------------------------------------------------------- the stand-in

export function createMemoryPlatform(options: MemoryPlatformOptions): MemoryPlatform {
	const { clock, ids, database } = options;
	const paths = {
		home: options.home ?? "/Users/conducted",
		appData: options.appData ?? "/Users/conducted/Library/Application Support/Conducted",
		temp: options.temp ?? "/tmp/conducted",
		resources: options.resources ?? "/Applications/Conducted.app/Contents/Resources",
	};

	type ValueListener<T> = (value: T) => void;

	const files = new Map<string, string>();
	const directories = new Set<string>(["/"]);
	const modified = new Map<string, number>();
	const trashed = new Map<string, string>();
	const secrets = new Map<string, string>();
	const logs: { level: string; message: string }[] = [];
	const shellCalls: ShellCommand[] = [];
	const shellScripts: ShellScript[] = [];
	const sidecarSent: string[] = [];
	const notificationsShown: { title: string; body: string; deepLink?: string }[] = [];
	const dialogAnswers: { folder?: string | null; files?: string[]; confirm?: boolean }[] = [];
	const programStatuses = new Map<ManagedProgram, ProgramStatus>();
	const ptyHistory = new Map<string, Uint8Array>();
	const ptyExitCodes: (number | null)[] = [];
	let dockBadge: number | null = null;
	let clipboardText: string | null = null;
	let holdNextStart = false;
	let windowFocused = true;

	const sidecarLineListeners = new Set<ValueListener<string>>();
	const sidecarRestartListeners = new Set<ValueListener<void>>();
	const notificationClickListeners = new Set<ValueListener<string>>();
	const deepLinkListeners = new Set<ValueListener<string>>();
	const quitListeners = new Set<ValueListener<void>>();
	const focusListeners = new Set<ValueListener<boolean>>();
	const fileDropListeners = new Set<ValueListener<FileDropEvent>>();
	const menuCommandListeners = new Set<ValueListener<string>>();
	const networkListeners = new Set<ValueListener<boolean>>();
	const programStatusListeners = new Set<ValueListener<ProgramStatus>>();

	const activeListeners = new Set<symbol>();
	const listen = <T>(set: Set<ValueListener<T>>, listener: ValueListener<T>): Unsubscribe => {
		const token = Symbol("listener");
		activeListeners.add(token);
		set.add(listener);
		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			activeListeners.delete(token);
			set.delete(listener);
		};
	};
	const emit = <T>(set: Set<ValueListener<T>>, value: T): void => {
		for (const listener of [...set]) listener(value);
	};

	const statForFile = (path: string): FileStat => {
		const text = files.get(path);
		return {
			path,
			isDirectory: false,
			isSymlink: false,
			size: text === undefined ? 0 : byteLength(text),
			modifiedAt: modified.get(path) ?? 0,
		};
	};

	const statForFolder = (path: string): FileStat => ({
		path,
		isDirectory: true,
		isSymlink: false,
		size: 0,
		modifiedAt: modified.get(path) ?? 0,
	});

	const addParentFolders = (path: string): void => {
		for (const ancestor of ancestors(path)) directories.add(ancestor);
	};

	const writeTextAtomic = async (path: string, text: string): Promise<Result<void>> => {
		const target = normalizePath(path);
		for (const ancestor of ancestors(target)) {
			if (files.has(ancestor)) {
				return err(appError("fs_not_a_directory", `${ancestor} is a file, not a folder.`));
			}
		}
		if (directories.has(target)) {
			return err(appError("fs_is_a_directory", `${target} is a folder.`));
		}
		addParentFolders(target);
		files.set(target, text);
		modified.set(target, clock.now());
		return ok(undefined);
	};

	const readText = async (path: string): Promise<Result<string>> => {
		const target = normalizePath(path);
		const text = files.get(target);
		return text === undefined
			? err(appError("fs_not_found", `${target} does not exist.`))
			: ok(text);
	};

	const exists = async (path: string): Promise<boolean> => {
		const target = normalizePath(path);
		return files.has(target) || directories.has(target);
	};

	const stat = async (path: string): Promise<Result<FileStat>> => {
		const target = normalizePath(path);
		if (files.has(target)) return ok(statForFile(target));
		if (directories.has(target)) return ok(statForFolder(target));
		return err(appError("fs_not_found", `${target} does not exist.`));
	};

	const mkdirp = async (path: string): Promise<Result<void>> => {
		const target = normalizePath(path);
		for (const folder of [...ancestors(target), target]) {
			if (files.has(folder)) {
				return err(appError("fs_not_a_directory", `${folder} is a file, not a folder.`));
			}
		}
		for (const folder of ancestors(target)) {
			directories.add(folder);
			modified.set(folder, clock.now());
		}
		directories.add(target);
		modified.set(target, clock.now());
		return ok(undefined);
	};

	const readDir = async (path: string): Promise<Result<FileStat[]>> => {
		const folder = normalizePath(path);
		if (!directories.has(folder)) {
			return err(appError("fs_not_found", `${folder} is not a folder.`));
		}
		const entries: FileStat[] = [];
		for (const file of files.keys()) {
			if (parentPath(file) === folder) entries.push(statForFile(file));
		}
		for (const dir of directories) {
			if (dir !== folder && parentPath(dir) === folder) entries.push(statForFolder(dir));
		}
		entries.sort((left, right) => left.path.localeCompare(right.path));
		return ok(entries);
	};

	const trash = async (path: string): Promise<Result<void>> => {
		const target = normalizePath(path);
		const text = files.get(target);
		if (text !== undefined) {
			trashed.set(target, text);
			files.delete(target);
			modified.delete(target);
			return ok(undefined);
		}
		if (directories.has(target)) {
			const prefix = `${target}/`;
			for (const file of [...files.keys()]) {
				if (!file.startsWith(prefix)) continue;
				const content = files.get(file);
				if (content !== undefined) trashed.set(file, content);
				files.delete(file);
				modified.delete(file);
			}
			for (const dir of [...directories]) {
				if (dir === target || dir.startsWith(prefix)) directories.delete(dir);
			}
			return ok(undefined);
		}
		return err(appError("fs_not_found", `${target} does not exist.`));
	};

	const listTree = async (root: string): Promise<Result<TreeEntry[]>> => {
		const base = normalizePath(root);
		const rules = ignoreRulesFor(base, files);
		const entries = new Map<string, TreeEntry>();
		for (const file of files.keys()) {
			if (!file.startsWith(`${base}/`)) continue;
			const relative = file.slice(base.length + 1);
			if (isIgnoredPath(relative, rules)) continue;
			const segments = relative.split("/");
			for (let index = 1; index < segments.length; index++) {
				const folder = segments.slice(0, index).join("/");
				if (!isIgnoredPath(folder, rules)) {
					entries.set(`${base}/${folder}`, { path: `${base}/${folder}`, isDirectory: true });
				}
			}
			entries.set(file, { path: file, isDirectory: false });
		}
		for (const dir of directories) {
			if (!dir.startsWith(`${base}/`)) continue;
			const relative = dir.slice(base.length + 1);
			if (!isIgnoredPath(relative, rules)) entries.set(dir, { path: dir, isDirectory: true });
		}
		return ok([...entries.values()].sort((left, right) => left.path.localeCompare(right.path)));
	};

	const listArtifacts = async (
		workspacePath: string,
		paging: { cursor: string | null; limit: number },
	) => {
		const context = `${normalizePath(workspacePath)}/.context`;
		const entries: FileStat[] = [];
		for (const file of files.keys()) {
			if (!file.startsWith(`${context}/`)) continue;
			entries.push(statForFile(file));
		}
		entries.sort(
			(left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path),
		);
		let start = 0;
		if (paging.cursor !== null) {
			start = /^\d+$/.test(paging.cursor) ? Number.parseInt(paging.cursor, 10) : -1;
			if (start < 0)
				return err(appError("invalid_cursor", `${paging.cursor} is not a page cursor.`));
		}
		const page = entries.slice(start, start + paging.limit);
		const nextCursor = start + paging.limit < entries.length ? String(start + paging.limit) : null;
		return ok({ entries: page, nextCursor, omitted: 0 });
	};

	const fuzzyMatch = async (
		root: string,
		query: string,
		limit: number,
	): Promise<Result<TreeEntry[]>> => {
		const base = normalizePath(root);
		const matches: { entry: TreeEntry; score: number }[] = [];
		for (const file of files.keys()) {
			if (!file.startsWith(`${base}/`)) continue;
			const relative = file.slice(base.length + 1);
			if (pathParts(relative).includes(".git")) continue;
			const score = fuzzyScore(relative, query);
			if (score >= 0) matches.push({ entry: { path: file, isDirectory: false }, score });
		}
		matches.sort(
			(left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path),
		);
		return ok(matches.slice(0, Math.max(0, limit)).map((match) => match.entry));
	};

	const grep = async (
		root: string,
		query: string,
		grepOptions: { caseSensitive: boolean; wholeWord: boolean; regex: boolean; limit: number },
	) => {
		let expression: RegExp;
		try {
			let pattern = grepOptions.regex ? query : escapeRegExp(query);
			if (grepOptions.wholeWord) pattern = `\\b(?:${pattern})\\b`;
			expression = new RegExp(pattern, grepOptions.caseSensitive ? "" : "i");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return err(appError("invalid_pattern", `Invalid pattern: ${message}`));
		}
		const base = normalizePath(root);
		const matches: { path: string; line: number; column: number; preview: string }[] = [];
		if (grepOptions.limit <= 0) return ok(matches);
		for (const [file, text] of files) {
			if (!file.startsWith(`${base}/`)) continue;
			const relative = file.slice(base.length + 1);
			if (pathParts(relative).includes(".git")) continue;
			const lines = text.split("\n");
			for (let index = 0; index < lines.length; index++) {
				const line = lines[index] ?? "";
				const match = expression.exec(line);
				if (match === null) continue;
				matches.push({
					path: file,
					line: index + 1,
					column: (match.index ?? 0) + 1,
					preview: line.trim(),
				});
				if (matches.length >= grepOptions.limit) return ok(matches);
			}
		}
		return ok(matches);
	};

	const fileSystem: FileSystem = {
		readText,
		writeTextAtomic,
		exists,
		stat,
		mkdirp,
		readDir,
		trash,
		paths,
	};

	const fileSearch: FileSearch = { listTree, listArtifacts, fuzzyMatch, grep };

	// ---------------------------------------------------------------- pty

	interface PtyState {
		id: string;
		cols: number;
		rows: number;
		output: string;
		dataListeners: Set<ValueListener<Uint8Array>>;
		exitListeners: Set<ValueListener<number | null>>;
		exited: boolean;
		exitCode: number | null;
	}

	const finishPty = (state: PtyState, code: number | null): void => {
		if (state.exited) return;
		state.exited = true;
		state.exitCode = code;
		ptyHistory.set(state.id, new TextEncoder().encode(state.output));
		for (const listener of [...state.exitListeners]) listener(code);
		state.exitListeners.clear();
	};

	const spawnPty = async (spawnOptions: {
		cwd: string;
		cols: number;
		rows: number;
		command?: { program: string; args: readonly string[] };
		env?: Readonly<Record<string, string>>;
	}): Promise<Result<PtyHandle>> => {
		const state: PtyState = {
			id: ids.uuid(),
			cols: spawnOptions.cols,
			rows: spawnOptions.rows,
			output: "",
			dataListeners: new Set(),
			exitListeners: new Set(),
			exited: false,
			exitCode: null,
		};
		const handle: PtyHandle = {
			id: state.id,
			write: async (data) => {
				if (state.exited) return;
				state.output += data;
				const chunk = new TextEncoder().encode(data);
				for (const listener of [...state.dataListeners]) listener(chunk);
			},
			resize: async (cols, rows) => {
				state.cols = cols;
				state.rows = rows;
			},
			kill: async () => {
				finishPty(state, 143);
			},
			onData: (listener) => listen(state.dataListeners, listener),
			ack: () => {},
			onExit: (listener) => {
				if (state.exited) {
					queueMicrotask(() => listener(state.exitCode));
					return () => {};
				}
				return listen(state.exitListeners, listener);
			},
			screenText: async (maxLines) => {
				const lines = stripAnsi(state.output).split("\n");
				return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
			},
			screenSnapshot: async (): Promise<Result<ScreenSnapshot>> =>
				ok({
					data: state.output,
					cols: state.cols,
					rows: state.rows,
					alternateScreen: false,
					bracketedPaste: false,
				}),
		};
		if (spawnOptions.command !== undefined) {
			const queued = ptyExitCodes.shift();
			queueMicrotask(() => finishPty(state, queued === undefined ? 0 : queued));
		}
		return ok(handle);
	};

	const pty: Pty = {
		spawn: spawnPty,
		loadHistory: async (terminalId) => ok(ptyHistory.get(terminalId) ?? new Uint8Array()),
	};

	// ---------------------------------------------------------------- shell

	const scripted = (command: ShellCommand): Result<ShellOutput> => {
		for (const script of shellScripts) {
			const answer = script(command);
			if (answer !== null) return answer;
		}
		return err(appError("shell_unscripted", `No answer was scripted for ${command.program}.`));
	};

	const shell: Shell = {
		run: async (command) => {
			shellCalls.push(command);
			return scripted(command);
		},
		start: (command) => {
			shellCalls.push(command);
			let settle: (result: Result<ShellOutput>) => void = () => {};
			let settled = false;
			const done = new Promise<Result<ShellOutput>>((resolve) => {
				settle = (result) => {
					if (settled) return;
					settled = true;
					resolve(result);
				};
			});
			if (holdNextStart) {
				holdNextStart = false;
			} else {
				const answer = scripted(command);
				queueMicrotask(() => settle(answer));
			}
			const running: RunningCommand = {
				id: ids.uuid(),
				done,
				cancel: async () => {
					// Rust reports a cancelled run as this error, not as an exit code (shell.rs).
					settle(err(appError("shell_cancelled", "The command was cancelled.")));
				},
			};
			return running;
		},
		loginEnv: async () => ({ shell: "/bin/zsh", path: "/opt/homebrew/bin:/usr/bin:/bin" }),
	};

	// ---------------------------------------------------------------- sidecar

	let sidecarStarted = false;
	const sidecar: SidecarTransport = {
		ensureStarted: async () => {
			sidecarStarted = true;
			return ok(undefined);
		},
		send: async (line) => {
			if (!sidecarStarted) {
				return err(appError("sidecar_not_started", "The sidecar has not been started."));
			}
			sidecarSent.push(line);
			return ok(undefined);
		},
		onLine: (listener) => listen(sidecarLineListeners, listener),
		onRestart: (listener) => listen(sidecarRestartListeners, listener),
		logPath: async () => `${paths.appData}/sidecar.log`,
	};

	// ---------------------------------------------------------------- operating system

	const keychain: Keychain = {
		get: async (key) => ok(secrets.get(key) ?? null),
		set: async (key, value) => {
			secrets.set(key, value);
			return ok(undefined);
		},
		delete: async (key) => {
			secrets.delete(key);
			return ok(undefined);
		},
	};

	const notifications: Notifications = {
		notify: async (input) => {
			notificationsShown.push({ ...input });
		},
		setDockBadge: async (count) => {
			dockBadge = count;
		},
		onClicked: (listener) => listen(notificationClickListeners, listener),
	};

	/** Takes the oldest queued answer that has the field, so a call never eats another kind's answer. */
	const takeAnswer = (
		field: "folder" | "files" | "confirm",
	): { folder?: string | null; files?: string[]; confirm?: boolean } | undefined => {
		const index = dialogAnswers.findIndex((answer) => field in answer);
		return index < 0 ? undefined : dialogAnswers.splice(index, 1)[0];
	};

	const dialogs: Dialogs = {
		pickFolder: async () => takeAnswer("folder")?.folder ?? null,
		pickFiles: async () => takeAnswer("files")?.files ?? [],
		pickSavePath: async () => null,
		confirm: async () => takeAnswer("confirm")?.confirm ?? false,
	};

	const opener: Opener = {
		openUrl: async () => {},
		revealInFinder: async () => {},
		openWith: async () => ok(undefined),
		installedApps: async () => [],
	};

	const clipboard: Clipboard = {
		writeText: async (text) => {
			clipboardText = text;
		},
		writeImage: async () => {},
	};

	let speechListener: ((event: SpeechEvent) => void) | null = null;
	const endSpeech = (): void => {
		const listener = speechListener;
		speechListener = null;
		listener?.({ kind: "ended" });
	};
	const speech: Speech = {
		available: async () => true,
		start: async (listener) => {
			speechListener = listener;
			return ok(undefined);
		},
		stop: async () => endSpeech(),
		cancel: async () => endSpeech(),
	};

	const updater: Updater = {
		check: async () => ok(null),
		install: async () => ok(undefined),
		relaunch: async () => {},
		installedUpdate: async () => ok(null),
	};

	const appWindow: AppWindow = {
		isFocused: async () => windowFocused,
		onFocusChanged: (listener) => listen(focusListeners, listener),
		onFileDrop: (listener) => listen(fileDropListeners, listener),
		setZoom: async () => ok(undefined),
		setVibrancy: async () => ok(undefined),
		setTrafficLightPosition: async () => ok(undefined),
		setTheme: async () => {},
		toggleInspector: async () => {},
	};

	const menu: AppMenu = {
		setShortcuts: async (shortcuts) =>
			ok({ applied: shortcuts.map((shortcut) => shortcut.commandId), rejected: [] }),
		onCommand: (listener) => listen(menuCommandListeners, listener),
	};

	const system: SystemFacts = {
		info: async () => ({ osVersion: "15.0", machineArch: "arm64", buildArch: "arm64" }),
		isOnline: async () => true,
		onNetworkChanged: (listener) => listen(networkListeners, listener),
		hasFullDiskAccess: async () => true,
		openFullDiskAccessSettings: async () => ok(undefined),
	};

	const materialize = async (
		sourcePath: string,
		destinationPath: string,
	): Promise<Result<MaterializedFile>> => {
		const text = files.get(normalizePath(sourcePath));
		if (text === undefined) {
			return err(appError("fs_not_found", `${sourcePath} does not exist.`));
		}
		const written = await writeTextAtomic(destinationPath, text);
		if (!written.ok) return written;
		return ok({
			path: normalizePath(destinationPath),
			sizeBytes: byteLength(text),
			isImage: false,
			width: null,
			height: null,
			resized: false,
		});
	};

	const attachments: AttachmentFiles = {
		materialize: async (sourcePath, destinationPath) => materialize(sourcePath, destinationPath),
		resizeImage: async (sourcePath, destinationPath) => materialize(sourcePath, destinationPath),
	};

	const statusFor = (program: ManagedProgram): ProgramStatus =>
		programStatuses.get(program) ?? {
			program,
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
		emit(programStatusListeners, status);
	};

	const programs: Programs = {
		statuses: async () => ok([...programStatuses.values()]),
		onStatus: (listener) => listen(programStatusListeners, listener),
		install: async (program) => {
			setProgramStatus({
				...statusFor(program),
				state: "ready",
				version: "test",
				path: `${paths.appData}/bin/${program}`,
			});
			return ok(undefined);
		},
		redownload: async (program) => {
			setProgramStatus({
				...statusFor(program),
				state: "ready",
				version: "test",
				path: `${paths.appData}/bin/${program}`,
			});
			return ok(undefined);
		},
		remove: async (program) => {
			setProgramStatus({
				...statusFor(program),
				state: "missing",
				version: null,
				path: null,
			});
			return ok(undefined);
		},
		prefetchForUpdate: async () => ok(undefined),
		verificationErrors: async () => [],
		syncPathOverrides: async () => ok(`${paths.appData}/bin`),
	};

	const http: Http = {
		fetch: async () =>
			err(appError("http_unscripted", "No HTTP answer was scripted for this request.")),
		download: () => ({
			id: ids.uuid(),
			done: Promise.resolve(
				err(appError("http_unscripted", "No HTTP answer was scripted for this request.")),
			),
			cancel: async () => {},
		}),
	};

	const app: AppInfo = {
		version: options.version ?? "0.0.0-test",
		channel: options.channel ?? "dev",
		health: async () => ok(undefined),
		dbVersionWarning: async () => ok(null),
		onDeepLink: (listener) => listen(deepLinkListeners, listener),
		onQuitRequested: (listener) => listen(quitListeners, listener),
		quit: async () => {},
		resourceUsage: async () => [],
		// The data argument is not kept, so a value that cannot be serialised cannot break logging.
		writeLog: (level, message) => {
			logs.push({ level, message });
		},
		setLogLevel: async () => {},
		exportLogs: async () => ok(`${paths.temp}/conducted-logs.zip`),
		setQuitHandlerReady: async () => {},
	};

	const controls: MemoryPlatformControls = {
		scriptShell: (script) => {
			shellScripts.unshift(script);
		},
		holdNextStart: () => {
			holdNextStart = true;
		},
		queuePtyExit: (code) => {
			ptyExitCodes.push(code);
		},
		get shellCalls() {
			return shellCalls;
		},
		files,
		get sidecarSent() {
			return sidecarSent;
		},
		emitSidecarLine: (line) => emit(sidecarLineListeners, line),
		emitSidecarRestart: () => emit(sidecarRestartListeners, undefined),
		emitNotificationClick: (deepLink) => emit(notificationClickListeners, deepLink),
		emitDeepLink: (url) => emit(deepLinkListeners, url),
		emitQuitRequested: () => emit(quitListeners, undefined),
		emitWindowFocus: (focused) => {
			windowFocused = focused;
			emit(focusListeners, focused);
		},
		get notificationsShown() {
			return notificationsShown;
		},
		get dockBadge() {
			return dockBadge;
		},
		get clipboardText() {
			return clipboardText;
		},
		queueDialogAnswers: (answers) => {
			dialogAnswers.push(answers);
		},
		secrets,
		get logs() {
			return logs;
		},
		dispose: () => activeListeners.size,
	};

	const platform: Platform = {
		app,
		db: database,
		shell,
		fs: fileSystem,
		fileSearch,
		pty,
		sidecar,
		keychain,
		notifications,
		dialogs,
		opener,
		clipboard,
		speech,
		updater,
		window: appWindow,
		menu,
		system,
		attachments,
		programs,
		http,
	};

	return { platform, controls };
}
