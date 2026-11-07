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
 * `listArtifacts` cursor is an Err, and `listArtifacts` leaves out the reserved `.context` files
 * and counts them in `omitted` the way file_search.rs does (the contract cases hold both);
 * `app.writeLog` keeps the level and message, not the data; the file system keeps text only, with
 * folders as path prefixes, and resolves `.` and `..` in a path the way the real one does; with
 * `enforceFileScope` the file commands refuse a path outside the default roots and the registered
 * ones with `fs_out_of_scope`, as files.rs does (the contract case "fs.register-root" holds it),
 * and without it every path is reachable, so a service test can seed files anywhere.
 * Our design choice: the stand-in is a factory returning the Platform together with its controls,
 * so production code cannot reach the controls through the Platform type.
 * Test first: the contract case "fs: write then read returns the same text" passes on it.
 */

import type { AppError, Clock, IdSource, ManagedProgram } from "@conducted/shared";
import { err, messageOf, ok, type Result } from "@conducted/shared";
import { globToRegExp } from "./glob.ts";
import type {
	AppInfo,
	AppMenu,
	AppWindow,
	AttachmentFiles,
	Clipboard,
	Cloud,
	CloudRelay,
	CloudRequest,
	CloudResponse,
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
	PtySpawn,
	RunningCommand,
	ScreenSnapshot,
	Shell,
	ShellCommand,
	ShellOutput,
	SidecarTransport,
	Speech,
	SpeechEvent,
	SystemFacts,
	SystemInfo,
	TreeEntry,
	Unsubscribe,
	Updater,
} from "./platform.ts";
import { platformError } from "./platform.ts";
import { stripTerminalEscapes } from "./terminal-escapes.ts";

/** A scripted answer for a shell command. Return null when the script does not know the command. */
export type ShellScript = (command: ShellCommand) => Result<ShellOutput> | null;

/** A scripted answer for a cloud request. Return null when the script does not know the path. */
export type CloudScript = (
	request: CloudRequest,
) => Promise<Result<CloudResponse>> | Result<CloudResponse> | null;

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
	/**
	 * Refuse paths outside the default roots and the registered ones with `fs_out_of_scope`, as
	 * files.rs does. Off by default, so a service test can seed files anywhere.
	 */
	enforceFileScope?: boolean;
}

export interface MemoryPlatformControls {
	/** Replaces the shell script. Later scripts are tried first. */
	scriptShell(script: ShellScript): void;
	/** Adds a cloud answer. Later scripts are tried first. */
	scriptCloud(script: CloudScript): void;
	/** Every cloud request made, in order. */
	readonly cloudRequests: readonly CloudRequest[];
	/** Every line the app sent to a cloud relay, in order. */
	readonly cloudSent: readonly { relayId: string; line: string }[];
	/** The ids of the relays the app opened and has not closed. */
	readonly cloudRelayIds: readonly string[];
	/** Changes what `cloud.paired` reports. */
	setCloudPaired(paired: boolean): void;
	/** Delivers a line to every listener of one relay. False when the relay is not open. */
	emitCloudLine(relayId: string, line: string): boolean;
	/** Ends one relay, as the Worker or the network would. False when the relay is not open. */
	emitCloudClosed(relayId: string, reason: string): boolean;
	/** Makes the next `shell.start` stay running until the caller cancels it. */
	holdNextStart(): void;
	/** The exit code of the next PTY spawned with a `command`. Null means a signal ended it. */
	queuePtyExit(code: number | null): void;
	/** Makes every terminal's `ack` fail with this message; null makes them succeed again. */
	failPtyAcks(message: string | null): void;
	/** Makes saving a terminal's history fail with this message when it ends; null undoes it. */
	failPtyHistory(message: string | null): void;
	/** Stores saved history for a terminal row, as a previous app run left it. */
	seedPtyHistory(terminalId: string, text: string): void;
	/** Every terminal start request, in order. */
	readonly ptySpawns: readonly PtySpawn[];
	/** The app's processes `app.resourceUsage` reports, each with its working folder. */
	setProcesses(processes: readonly MemoryProcess[]): void;
	/** Changes what `system.info` reports, for a test about a Mac other than the default. */
	setSystemInfo(info: SystemInfo): void;
	/** Makes the next `system.info` calls fail with this message. */
	failSystemInfo(message: string): void;
	/** Changes what `system.hasFullDiskAccess` reports. */
	setFullDiskAccess(granted: boolean): void;
	/** Sets one managed program's status, as the program manager would report it. */
	setProgramStatus(status: ProgramStatus): void;
	/** Makes `system.hasFullDiskAccess` fail with this message; null restores the answer. */
	failFullDiskAccessCheck(message: string | null): void;
	/** Makes `system.openFullDiskAccessSettings` fail with this message; null restores success. */
	failOpenFullDiskAccessSettings(message: string | null): void;
	/** Every command given to `shell.run` and `shell.start`, in order. */
	readonly shellCalls: readonly ShellCommand[];
	/** Text files by absolute path. Reading and writing through `fs` use this map. */
	readonly files: Map<string, string>;
	/** Folders registered with `fs.registerRoot`, in order, as stored. */
	readonly registeredRoots: readonly string[];
	/** Makes a folder and its parents exist on the user's disk, outside the app's file scope. */
	addFolder(path: string): void;
	/** Lines the app sent to the sidecar, in order. */
	readonly sidecarSent: readonly string[];
	/** Delivers a line to `sidecar.onLine` listeners. */
	emitSidecarLine(line: string): void;
	emitSidecarRestart(): void;
	/** Delivers a notification click and a deep link. */
	emitNotificationClick(deepLink: string): void;
	emitDeepLink(url: string): void;
	/** Delivers a link the Rust shell refused, such as one over 64 KiB. */
	emitDeepLinkRejected(rejection: AppError): void;
	emitQuitRequested(): void;
	/** Changes the window's focus and tells every focus listener. */
	emitWindowFocus(focused: boolean): void;
	/** Changes the network state and tells every network listener. */
	emitNetworkChanged(online: boolean): void;
	/** Delivers one file drag event to every file drop listener. */
	emitFileDrop(event: FileDropEvent): void;
	/** The app zoom, window theme, sidebar vibrancy and traffic-light inset last set. */
	readonly windowZoom: number | null;
	readonly windowTheme: "light" | "dark" | null;
	readonly vibrancy: boolean | null;
	readonly trafficLightPosition: { x: number; y: number } | null;
	/** Notifications shown and the last dock badge. */
	readonly notificationsShown: readonly { title: string; body: string; deepLink?: string }[];
	readonly dockBadge: number | null;
	/** The last text written to the clipboard. */
	readonly clipboardText: string | null;
	/** Puts files on the clipboard, as if copied in Finder. */
	setClipboardFilePaths(paths: readonly string[]): void;
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

/** One process of the app, as the process table lists it. */
export interface MemoryProcess {
	pid: number;
	name: string;
	cpuPercent: number;
	memoryBytes: number;
	/** Its working folder, which places it in a workspace. */
	cwd: string;
}

export interface MemoryPlatform {
	platform: Platform;
	controls: MemoryPlatformControls;
}

// ---------------------------------------------------------------- paths

/**
 * Collapses repeated slashes and resolves `.` and `..` by spelling, as the real file system does,
 * so `/a/b/../c` and `/a/c` name the same file. A `..` at the top of an absolute path stays at `/`.
 */
const normalizePath = (path: string): string => {
	const absolute = path.startsWith("/");
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part !== "..") parts.push(part);
		else if (parts.length > 0 && parts.at(-1) !== "..") parts.pop();
		else if (!absolute) parts.push(part);
	}
	const joined = parts.join("/");
	if (joined === "") return "/";
	return absolute ? `/${joined}` : joined;
};

/** Most artifact entries one page returns, as file_search.rs `MAX_ARTIFACT_PAGE`. */
const MAX_ARTIFACT_PAGE = 200;
/** As file_search.rs: paths match from the `.context` root, names match at any depth. */
const ARTIFACT_EXCLUDED_PATHS = ["todos.md", "conductor", "pull-requests", "attachments/comments"];
const ARTIFACT_EXCLUDED_NAMES = [
	"PR instructions.md",
	"Review request.md",
	"Fix errors instructions.md",
];

/** Whether a file below `.context` is one the Artifacts list leaves out (services-map.md 5A.6.2). */
const isExcludedArtifact = (relative: string): boolean => {
	if (
		ARTIFACT_EXCLUDED_PATHS.some(
			(excluded) => relative === excluded || relative.startsWith(`${excluded}/`),
		)
	) {
		return true;
	}
	const name = relative.slice(relative.lastIndexOf("/") + 1);
	if (ARTIFACT_EXCLUDED_NAMES.includes(name)) return true;
	if (/^\[GITHUB\]-\d+\.md$/.test(name)) return true;
	if (/^\[LINEAR\]-.*-\d+\.md$/.test(name)) return true;
	return name.startsWith("terminal-output") && name.endsWith(".txt");
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

/**
 * The folders the file commands reach without a registration, as files.rs `allowed_roots` lists
 * them: the app's own folders, the Claude configuration and the default workspaces folder.
 */
export const defaultFileRoots = (paths: FileSystem["paths"]): string[] => [
	paths.appData,
	paths.temp,
	paths.resources,
	`${paths.home}/.claude.json`,
	`${paths.home}/.claude`,
	`${paths.home}/.conducted`,
	`${paths.home}/Library/Application Support/Claude/claude_desktop_config.json`,
	`${paths.home}/conducted`,
];

/**
 * The URL Tauri's `convertFileSrc` gives on macOS: the asset protocol with the whole path
 * percent-encoded as one segment.
 */
export const assetUrlOf = (path: string): string => `asset://localhost/${encodeURIComponent(path)}`;

/** True when `path` is `root` or lies below it, compared by spelling after `.` and `..`. */
export const isWithinRoot = (path: string, root: string): boolean => {
	const target = normalizePath(path);
	const base = normalizePath(root);
	return target === base || target.startsWith(base === "/" ? "/" : `${base}/`);
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
	const registeredRoots: string[] = [];
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
	let clipboardFilePaths: string[] = [];
	let ptyAckFailure: string | null = null;
	let ptyHistoryFailure: string | null = null;
	const ptySpawns: PtySpawn[] = [];
	let processes: MemoryProcess[] = [];
	let holdNextStart = false;
	let systemInfo: SystemInfo = { osVersion: "15.0", machineArch: "arm64", buildArch: "arm64" };
	let systemInfoFailure: string | null = null;
	let fullDiskAccess = true;
	let fullDiskAccessFailure: string | null = null;
	let fullDiskAccessOpenFailure: string | null = null;
	let windowFocused = true;
	let windowZoom: number | null = null;
	let windowTheme: "light" | "dark" | null = null;
	let vibrancy: boolean | null = null;
	let trafficLightPosition: { x: number; y: number } | null = null;
	let networkOnline = true;

	const sidecarLineListeners = new Set<ValueListener<string>>();
	const sidecarRestartListeners = new Set<ValueListener<void>>();
	const notificationClickListeners = new Set<ValueListener<string>>();
	const deepLinkListeners = new Set<ValueListener<string>>();
	const deepLinkRejectedListeners = new Set<ValueListener<AppError>>();
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

	/** The files.rs scope check, when the test asked for it. Null means the path may be used. */
	const outOfScope = (path: string): AppError | null => {
		if (options.enforceFileScope !== true) return null;
		if (!path.startsWith("/")) {
			return platformError("fs_relative_path", `Path must be absolute: ${path}`);
		}
		const roots = [...defaultFileRoots(paths), ...registeredRoots];
		if (roots.some((root) => isWithinRoot(path, root))) return null;
		return platformError(
			"fs_out_of_scope",
			`Path is outside the folders this window may reach: ${path}`,
		);
	};

	const registerRoot = async (path: string): Promise<Result<void>> => {
		if (!path.startsWith("/")) {
			return err(platformError("fs_relative_path", `Path must be absolute: ${path}`));
		}
		const root = normalizePath(path);
		if (!registeredRoots.includes(root)) registeredRoots.push(root);
		return ok(undefined);
	};

	const writeTextAtomic = async (path: string, text: string): Promise<Result<void>> => {
		const refused = outOfScope(path);
		if (refused !== null) return err(refused);
		const target = normalizePath(path);
		for (const ancestor of ancestors(target)) {
			if (files.has(ancestor)) {
				return err(platformError("fs_not_a_directory", `${ancestor} is a file, not a folder.`));
			}
		}
		if (directories.has(target)) {
			return err(platformError("fs_is_a_directory", `${target} is a folder.`));
		}
		addParentFolders(target);
		files.set(target, text);
		modified.set(target, clock.now());
		return ok(undefined);
	};

	const readText = async (path: string): Promise<Result<string>> => {
		const refused = outOfScope(path);
		if (refused !== null) return err(refused);
		const target = normalizePath(path);
		const text = files.get(target);
		return text === undefined
			? err(platformError("fs_not_found", `${target} does not exist.`))
			: ok(text);
	};

	const exists = async (path: string): Promise<boolean> => {
		if (outOfScope(path) !== null) return false;
		const target = normalizePath(path);
		return files.has(target) || directories.has(target);
	};

	const stat = async (path: string): Promise<Result<FileStat>> => {
		const refused = outOfScope(path);
		if (refused !== null) return err(refused);
		const target = normalizePath(path);
		if (files.has(target)) return ok(statForFile(target));
		if (directories.has(target)) return ok(statForFolder(target));
		return err(platformError("fs_not_found", `${target} does not exist.`));
	};

	const mkdirp = async (path: string): Promise<Result<void>> => {
		const refused = outOfScope(path);
		if (refused !== null) return err(refused);
		const target = normalizePath(path);
		for (const folder of [...ancestors(target), target]) {
			if (files.has(folder)) {
				return err(platformError("fs_not_a_directory", `${folder} is a file, not a folder.`));
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
		const refused = outOfScope(path);
		if (refused !== null) return err(refused);
		const folder = normalizePath(path);
		if (!directories.has(folder)) {
			return err(platformError("fs_not_found", `${folder} is not a folder.`));
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
		const refused = outOfScope(path);
		if (refused !== null) return err(refused);
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
		return err(platformError("fs_not_found", `${target} does not exist.`));
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
		let omitted = 0;
		for (const file of files.keys()) {
			if (!file.startsWith(`${context}/`)) continue;
			if (isExcludedArtifact(file.slice(context.length + 1))) {
				omitted += 1;
				continue;
			}
			entries.push(statForFile(file));
		}
		entries.sort(
			(left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path),
		);
		let start = 0;
		if (paging.cursor !== null) {
			start = /^\d+$/.test(paging.cursor) ? Number.parseInt(paging.cursor, 10) : -1;
			if (start < 0)
				return err(platformError("invalid_cursor", `${paging.cursor} is not a page cursor.`));
		}
		if (start > entries.length) {
			return err(platformError("invalid_cursor", `${paging.cursor} is not a page cursor.`));
		}
		const limit = Math.min(Math.max(Math.floor(paging.limit), 1), MAX_ARTIFACT_PAGE);
		const page = entries.slice(start, start + limit);
		const nextCursor = start + limit < entries.length ? String(start + limit) : null;
		return ok({ entries: page, nextCursor, omitted });
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
			const message = messageOf(error);
			return err(platformError("search_bad_pattern", `Invalid pattern: ${message}`));
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
		registerRoot,
		assetUrl: assetUrlOf,
		paths,
	};

	const fileSearch: FileSearch = { listTree, listArtifacts, fuzzyMatch, grep };

	// ---------------------------------------------------------------- pty

	interface PtyState {
		id: string;
		/** The terminal row's id, which names its saved history. */
		terminalId: string;
		cols: number;
		rows: number;
		output: string;
		dataListeners: Set<ValueListener<Uint8Array>>;
		exitListeners: Set<ValueListener<{ code: number | null; historyError: AppError | null }>>;
		exited: boolean;
		exitCode: number | null;
		historyError: AppError | null;
	}

	const finishPty = (state: PtyState, code: number | null): void => {
		if (state.exited) return;
		state.exited = true;
		state.exitCode = code;
		if (ptyHistoryFailure === null) {
			ptyHistory.set(state.terminalId, new TextEncoder().encode(state.output));
		} else {
			state.historyError = platformError("history_save_failed", ptyHistoryFailure);
		}
		for (const listener of [...state.exitListeners]) {
			listener({ code, historyError: state.historyError });
		}
		state.exitListeners.clear();
	};

	const spawnPty = async (spawnOptions: PtySpawn): Promise<Result<PtyHandle>> => {
		const state: PtyState = {
			id: ids.uuid(),
			terminalId: spawnOptions.terminalId,
			cols: spawnOptions.cols,
			rows: spawnOptions.rows,
			output: "",
			dataListeners: new Set(),
			exitListeners: new Set(),
			exited: false,
			exitCode: null,
			historyError: null,
		};
		ptySpawns.push(spawnOptions);
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
			ack: async () =>
				ptyAckFailure === null
					? ok(undefined)
					: err(platformError("pty_ack_failed", ptyAckFailure)),
			onExit: (listener) => {
				if (state.exited) {
					queueMicrotask(() => listener(state.exitCode, state.historyError));
					return () => {};
				}
				return listen(state.exitListeners, (exit) => listener(exit.code, exit.historyError));
			},
			screenText: async (maxLines) => {
				const lines = stripTerminalEscapes(state.output).split("\n");
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
		return err(platformError("shell_unscripted", `No answer was scripted for ${command.program}.`));
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
					settle(err(platformError("shell_cancelled", "The command was cancelled.")));
				},
			};
			return running;
		},
		loginEnv: async (cwd) => {
			if (cwd !== undefined && !cwd.startsWith("/")) {
				throw platformError("shell_bad_cwd", `The working folder must be an absolute path: ${cwd}`);
			}
			return { shell: "/bin/zsh", path: "/opt/homebrew/bin:/usr/bin:/bin", zdotdir: null };
		},
	};

	// ---------------------------------------------------------------- sidecar

	let sidecarStarted = false;
	const sidecar: SidecarTransport = {
		ensureStarted: async () => {
			sidecarStarted = true;
			return ok(undefined);
		},
		send: async (line) => {
			// As sidecar_send does, first: the newline that ends the line is added on the way out.
			if (line.includes("\n") || line.includes("\r")) {
				return err(platformError("sidecar_bad_line", "A sidecar line must not contain a newline."));
			}
			if (!sidecarStarted) {
				return err(platformError("sidecar_not_started", "The sidecar has not been started."));
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
		readFilePaths: async () => ok([...clipboardFilePaths]),
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
		setZoom: async (factor) => {
			windowZoom = factor;
			return ok(undefined);
		},
		setVibrancy: async (enabled) => {
			vibrancy = enabled;
			return ok(undefined);
		},
		setTrafficLightPosition: async (x, y) => {
			trafficLightPosition = { x, y };
			return ok(undefined);
		},
		setTheme: async (theme) => {
			windowTheme = theme;
		},
		toggleInspector: async () => {},
	};

	const menu: AppMenu = {
		setShortcuts: async (shortcuts) =>
			ok({ applied: shortcuts.map((shortcut) => shortcut.commandId), rejected: [] }),
		onCommand: (listener) => listen(menuCommandListeners, listener),
	};

	const system: SystemFacts = {
		info: async () => {
			if (systemInfoFailure !== null) throw new Error(systemInfoFailure);
			return systemInfo;
		},
		isOnline: async () => networkOnline,
		onNetworkChanged: (listener) => listen(networkListeners, listener),
		hasFullDiskAccess: async () => {
			if (fullDiskAccessFailure !== null) throw new Error(fullDiskAccessFailure);
			return fullDiskAccess;
		},
		openFullDiskAccessSettings: async () =>
			fullDiskAccessOpenFailure === null
				? ok(undefined)
				: err(platformError("full_disk_access_open_failed", fullDiskAccessOpenFailure)),
	};

	const materialize = async (
		sourcePath: string,
		destinationPath: string,
	): Promise<Result<MaterializedFile>> => {
		const text = files.get(normalizePath(sourcePath));
		if (text === undefined) {
			return err(
				platformError("attachment_missing", `Attachment source does not exist: ${sourcePath}`),
			);
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
		writeBytes: async (bytes, destinationPath) => {
			// The stand-in keeps text only, so the bytes are kept as UTF-8 text.
			const written = await writeTextAtomic(destinationPath, new TextDecoder().decode(bytes));
			if (!written.ok) return written;
			return ok({
				path: normalizePath(destinationPath),
				sizeBytes: bytes.length,
				isImage: false,
				width: null,
				height: null,
				resized: false,
			});
		},
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
			err(platformError("http_unscripted", "No HTTP answer was scripted for this request.")),
		download: () => ({
			id: ids.uuid(),
			done: Promise.resolve(
				err(platformError("http_unscripted", "No HTTP answer was scripted for this request.")),
			),
			cancel: async () => {},
		}),
	};

	const cloudScripts: CloudScript[] = [];
	const cloudRequests: CloudRequest[] = [];
	const cloudSent: { relayId: string; line: string }[] = [];
	let cloudPaired = true;
	interface MemoryRelay {
		url: string;
		vmId: string;
		lineListeners: Set<(line: string) => void>;
		closedListeners: Set<(reason: string) => void>;
		closed: string | null;
	}
	const cloudRelays = new Map<string, MemoryRelay>();
	const cloud: Cloud = {
		paired: async () => ok(cloudPaired),
		request: async (request) => {
			cloudRequests.push(request);
			for (const script of cloudScripts) {
				const answer = await script(request);
				if (answer !== null) return answer;
			}
			return err(
				platformError("cloud_unscripted", "No cloud answer was scripted for this request."),
			);
		},
		openRelay: async (input) => {
			const id = ids.uuid();
			const state: MemoryRelay = {
				url: input.url,
				vmId: input.vmId,
				lineListeners: new Set(),
				closedListeners: new Set(),
				closed: null,
			};
			cloudRelays.set(id, state);
			const relay: CloudRelay = {
				id,
				send: async (line) => {
					if (state.closed !== null) {
						return err(platformError("cloud_relay_closed", "The relay is closed."));
					}
					if (line.includes("\n") || line.includes("\r")) {
						return err(platformError("cloud_bad_line", "A relay line cannot hold a newline."));
					}
					cloudSent.push({ relayId: id, line });
					return ok(undefined);
				},
				onLine: (listener) => {
					state.lineListeners.add(listener);
					return () => state.lineListeners.delete(listener);
				},
				onClosed: (listener) => {
					if (state.closed !== null) {
						queueMicrotask(() => listener(state.closed as string));
						return () => {};
					}
					state.closedListeners.add(listener);
					return () => state.closedListeners.delete(listener);
				},
				close: async () => {
					cloudRelays.delete(id);
					if (state.closed === null) state.closed = "The relay was closed.";
				},
			};
			return ok(relay);
		},
	};

	const app: AppInfo = {
		version: options.version ?? "0.0.0-test",
		channel: options.channel ?? "dev",
		health: async () => ok(undefined),
		dbVersionWarning: async () => ok(null),
		onDeepLink: (listener) => listen(deepLinkListeners, listener),
		onDeepLinkRejected: (listener) => listen(deepLinkRejectedListeners, listener),
		onQuitRequested: (listener) => listen(quitListeners, listener),
		quit: async () => {},
		resourceUsage: async (workspacePaths) =>
			ok(
				processes.map(({ cwd, ...usage }) => {
					const owner = workspacePaths
						.filter((path) => isWithinRoot(cwd, path))
						.sort((left, right) => right.length - left.length)[0];
					return owner === undefined ? usage : { ...usage, workspacePath: owner };
				}),
			),
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
		scriptCloud: (script) => {
			cloudScripts.unshift(script);
		},
		get cloudRequests() {
			return cloudRequests;
		},
		get cloudSent() {
			return cloudSent;
		},
		get cloudRelayIds() {
			return [...cloudRelays.keys()];
		},
		setCloudPaired: (paired) => {
			cloudPaired = paired;
		},
		emitCloudLine: (relayId, line) => {
			const relay = cloudRelays.get(relayId);
			if (relay === undefined) return false;
			for (const listener of relay.lineListeners) listener(line);
			return true;
		},
		emitCloudClosed: (relayId, reason) => {
			const relay = cloudRelays.get(relayId);
			if (relay === undefined) return false;
			relay.closed = reason;
			cloudRelays.delete(relayId);
			for (const listener of relay.closedListeners) listener(reason);
			return true;
		},
		holdNextStart: () => {
			holdNextStart = true;
		},
		queuePtyExit: (code) => {
			ptyExitCodes.push(code);
		},
		failPtyAcks: (message) => {
			ptyAckFailure = message;
		},
		failPtyHistory: (message) => {
			ptyHistoryFailure = message;
		},
		seedPtyHistory: (terminalId, text) => {
			ptyHistory.set(terminalId, new TextEncoder().encode(text));
		},
		get ptySpawns() {
			return ptySpawns;
		},
		setProcesses: (next) => {
			processes = [...next];
		},
		setSystemInfo: (info) => {
			systemInfo = info;
			systemInfoFailure = null;
		},
		failSystemInfo: (message) => {
			systemInfoFailure = message;
		},
		setFullDiskAccess: (granted) => {
			fullDiskAccess = granted;
		},
		failFullDiskAccessCheck: (message) => {
			fullDiskAccessFailure = message;
		},
		failOpenFullDiskAccessSettings: (message) => {
			fullDiskAccessOpenFailure = message;
		},
		get shellCalls() {
			return shellCalls;
		},
		files,
		get registeredRoots() {
			return registeredRoots;
		},
		addFolder: (path) => {
			const target = normalizePath(path);
			addParentFolders(target);
			directories.add(target);
		},
		get sidecarSent() {
			return sidecarSent;
		},
		emitSidecarLine: (line) => emit(sidecarLineListeners, line),
		emitSidecarRestart: () => emit(sidecarRestartListeners, undefined),
		emitNotificationClick: (deepLink) => emit(notificationClickListeners, deepLink),
		emitDeepLink: (url) => emit(deepLinkListeners, url),
		emitDeepLinkRejected: (rejection) => emit(deepLinkRejectedListeners, rejection),
		emitQuitRequested: () => emit(quitListeners, undefined),
		emitWindowFocus: (focused) => {
			windowFocused = focused;
			emit(focusListeners, focused);
		},
		emitNetworkChanged: (online) => {
			networkOnline = online;
			emit(networkListeners, online);
		},
		emitFileDrop: (event) => emit(fileDropListeners, event),
		get windowZoom() {
			return windowZoom;
		},
		get windowTheme() {
			return windowTheme;
		},
		get vibrancy() {
			return vibrancy;
		},
		get trafficLightPosition() {
			return trafficLightPosition;
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
		setClipboardFilePaths: (paths) => {
			clipboardFilePaths = [...paths];
		},
		setProgramStatus,
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
		cloud,
	};

	return { platform, controls };
}
