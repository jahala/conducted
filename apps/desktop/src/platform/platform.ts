/**
 * The Platform interface: the only door between the web UI and the Rust shell.
 *
 * Only files in `src/platform/` may import `@tauri-apps/*` (enforced by biome.json). Services in
 * `src/core/` receive a Platform as a parameter, so tests can pass an in-memory stand-in that is
 * checked against the real one by a shared contract test (PLAT-01).
 *
 * Research: services-map.md 1.1 (Conductor's `vn()` Platform object), native-and-sidecar-map.md A2
 * (the Rust commands behind each group). Cloud groups are left out.
 */
import type { AppError, Result } from "@conducted/shared";

export type Unsubscribe = () => void;

// ---------------------------------------------------------------- database

export interface SqlResult {
	rowsAffected: number;
	lastInsertId?: number;
}

/** conducted.db through tauri-plugin-sql. Parameters use `$1, $2, ...`. */
export interface Database {
	execute(sql: string, params?: readonly unknown[]): Promise<SqlResult>;
	select<Row>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
	/** Runs `work` inside BEGIN IMMEDIATE ... COMMIT, rolling back if it throws. */
	transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------- shell

export interface ShellCommand {
	/** Program and arguments. Never a shell string: arguments are passed as-is. */
	program: string;
	args: readonly string[];
	cwd: string;
	/** Extra environment on top of the captured login-shell environment. */
	env?: Readonly<Record<string, string>>;
	/** Text written to stdin, then stdin is closed. */
	stdin?: string;
	/** Kill the whole process group after this many milliseconds. Catches hangs, not slowness. */
	timeoutMs?: number;
}

export interface ShellOutput {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface RunningCommand {
	readonly id: string;
	readonly done: Promise<Result<ShellOutput>>;
	cancel(): Promise<void>;
}

export interface Shell {
	run(command: ShellCommand): Promise<Result<ShellOutput>>;
	start(command: ShellCommand): RunningCommand;
	/** The user's login shell and PATH, captured once at startup by the Rust shell. */
	loginEnv(): Promise<{ shell: string; path: string }>;
}

// ---------------------------------------------------------------- files

export interface FileStat {
	path: string;
	isDirectory: boolean;
	isSymlink: boolean;
	size: number;
	modifiedAt: number;
}

export interface FileSystem {
	readText(path: string): Promise<Result<string>>;
	/** Writes to a temp file and renames it into place, so readers never see half a file. */
	writeTextAtomic(path: string, text: string): Promise<Result<void>>;
	exists(path: string): Promise<boolean>;
	stat(path: string): Promise<Result<FileStat>>;
	mkdirp(path: string): Promise<Result<void>>;
	readDir(path: string): Promise<Result<FileStat[]>>;
	/** Moves to the macOS Trash. The app never deletes user files for good. */
	trash(path: string): Promise<Result<void>>;
	paths: { home: string; appData: string; temp: string; resources: string };
}

export interface TreeEntry {
	path: string;
	isDirectory: boolean;
}

export interface GrepMatch {
	path: string;
	line: number;
	column: number;
	preview: string;
}

/** Fast, gitignore-aware search done in Rust (file_search.rs). */
export interface FileSearch {
	listTree(root: string): Promise<Result<TreeEntry[]>>;
	fuzzyMatch(root: string, query: string, limit: number): Promise<Result<TreeEntry[]>>;
	grep(
		root: string,
		query: string,
		options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean; limit: number },
	): Promise<Result<GrepMatch[]>>;
}

// ---------------------------------------------------------------- terminals

export interface PtySpawn {
	cwd: string;
	cols: number;
	rows: number;
	/** Run this program instead of an interactive login shell (setup and run scripts). */
	command?: { program: string; args: readonly string[] };
	env?: Readonly<Record<string, string>>;
}

export interface PtyHandle {
	readonly id: string;
	write(data: string): Promise<void>;
	resize(cols: number, rows: number): Promise<void>;
	kill(): Promise<void>;
	/** Output arrives in chunks. Call `ack` with the byte count once rendered (flow control). */
	onData(listener: (chunk: Uint8Array) => void): Unsubscribe;
	ack(bytes: number): void;
	onExit(listener: (exitCode: number | null) => void): Unsubscribe;
	/** Plain text of the visible screen plus scrollback, for the GetTerminalOutput tool. */
	screenText(maxLines: number): Promise<string>;
}

export interface Pty {
	spawn(options: PtySpawn): Promise<Result<PtyHandle>>;
	/** Saved scrollback of an ended terminal, for reopening it after a restart. */
	loadHistory(terminalId: string): Promise<Result<Uint8Array>>;
}

// ---------------------------------------------------------------- sidecar

/** Raw line transport to the sidecar. JSON-RPC framing lives in core/sidecar/tunnel.ts. */
export interface SidecarTransport {
	ensureStarted(): Promise<Result<void>>;
	send(line: string): Promise<Result<void>>;
	onLine(listener: (line: string) => void): Unsubscribe;
	/** Fires when the sidecar process exits or restarts. */
	onRestart(listener: () => void): Unsubscribe;
	logPath(): Promise<string>;
}

// ---------------------------------------------------------------- operating system

export interface Keychain {
	get(key: string): Promise<Result<string | null>>;
	set(key: string, value: string): Promise<Result<void>>;
	delete(key: string): Promise<Result<void>>;
}

export interface Notifications {
	/** Shows a native notification. Clicking it opens `deepLink` inside the app. */
	notify(input: { title: string; body: string; deepLink?: string }): Promise<void>;
	setDockBadge(count: number | null): Promise<void>;
	onClicked(listener: (deepLink: string) => void): Unsubscribe;
}

export interface Dialogs {
	pickFolder(options: { title: string; defaultPath?: string }): Promise<string | null>;
	pickFiles(options: { title: string; multiple: boolean }): Promise<string[]>;
	confirm(options: { title: string; message: string; okLabel: string }): Promise<boolean>;
}

export interface Opener {
	openUrl(url: string): Promise<void>;
	revealInFinder(path: string): Promise<void>;
	/** Opens a folder or file in another app, e.g. "Cursor", "Visual Studio Code", "Ghostty". */
	openWith(appName: string, path: string): Promise<Result<void>>;
	installedApps(): Promise<string[]>;
}

export interface Clipboard {
	writeText(text: string): Promise<void>;
	writeImage(pngBytes: Uint8Array): Promise<void>;
}

/** Apple on-device dictation (on_device_speech.rs). */
export interface Speech {
	available(): Promise<boolean>;
	start(onText: (text: string, isFinal: boolean) => void): Promise<Result<void>>;
	stop(): Promise<void>;
	cancel(): Promise<void>;
}

export interface Updater {
	check(): Promise<Result<{ version: string; notes: string } | null>>;
	/** Downloads and installs; the app restarts when every agent is idle. */
	install(): Promise<Result<void>>;
	relaunch(): Promise<void>;
}

export interface ProcessUsage {
	pid: number;
	name: string;
	cpuPercent: number;
	memoryBytes: number;
	/** The workspace the process belongs to, when known. */
	workspacePath?: string;
}

export interface AppInfo {
	version: string;
	/** "dev" while running under `tauri dev`. */
	channel: "dev" | "release";
	health(): Promise<Result<void, AppError>>;
	onDeepLink(listener: (url: string) => void): Unsubscribe;
	onQuitRequested(listener: () => void): Unsubscribe;
	quit(): Promise<void>;
	resourceUsage(): Promise<ProcessUsage[]>;
	writeLog(level: "error" | "warn" | "info" | "debug", message: string, data?: unknown): void;
	exportLogs(): Promise<Result<string>>;
}

// ---------------------------------------------------------------- the whole

export interface Platform {
	app: AppInfo;
	db: Database;
	shell: Shell;
	fs: FileSystem;
	fileSearch: FileSearch;
	pty: Pty;
	sidecar: SidecarTransport;
	keychain: Keychain;
	notifications: Notifications;
	dialogs: Dialogs;
	opener: Opener;
	clipboard: Clipboard;
	speech: Speech;
	updater: Updater;
}
