/**
 * @feature PLAT-02 Tauri implementation of the Platform interface
 * Owns: the one place that talks to Tauri. Every `Platform` group is built here from the command
 * names in docs/plans/tauri-commands.md and from the Tauri plugins (sql, dialog, clipboard,
 * deep-link, opener, notification). Only this folder may import `@tauri-apps/*`.
 * Behaviour: services-map.md 1.1 (Conductor's Platform object: the only code that touches
 * Tauri), native-and-sidecar-map.md A2 (the commands behind each group), docs/plans/
 * tauri-commands.md (command names, camelCase arguments, `Result<T, CommandError>`).
 * Must handle: a Rust command rejects with `{ code, message }`; a plugin rejects with a string or
 * an Error; both become `AppError` values and never reach a service as an exception; binary data
 * (terminal output, history, images) crosses as base64 strings or a Channel, never as number
 * arrays; event listeners return an unsubscribe function and every one is released by the caller;
 * `pty.spawn` and `speech.start` pass a Channel for streamed output; a command that is slower
 * than its `timeoutMs` is the Rust side's job (it kills the process group); the database opens
 * `sqlite:conducted.db` through the sql plugin and must run `PRAGMA journal_mode = WAL` and
 * `PRAGMA foreign_keys = ON` on its connection before the first statement; `Database.transaction`
 * must serialise: one open transaction at a time, because the plugin pools connections.
 * Our design choice: the group builders take a `TauriBindings` value instead of importing `invoke`
 * themselves, so the helpers below can be tested without a webview. `realTauriBindings` is the
 * only place that holds the real functions. The argument names of each command are listed in
 * the doc comment above its builder; the Rust side must match them.
 * Test first: toAppError turns `{ code: "io", message: "no such file" }` into the same AppError,
 * and a plain string into code `tauri_error`.
 */

import { type AppError, appError, err, notImplemented, ok, type Result } from "@conducted/shared";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
	AppInfo,
	Clipboard,
	Database,
	Dialogs,
	FileSearch,
	FileSystem,
	Keychain,
	Notifications,
	Opener,
	Platform,
	Pty,
	Shell,
	SidecarTransport,
	Speech,
	Updater,
} from "./platform.ts";

// ---------------------------------------------------------------- bindings

export interface TauriBindings {
	invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
	listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>;
}

export const realTauriBindings: TauriBindings = {
	invoke: (command, args) => invoke(command, args),
	listen: (event, handler) => listen(event, (e) => handler(e.payload as never)),
};

// ---------------------------------------------------------------- names (docs/plans/tauri-commands.md)

/** Command names registered by the Rust shell. Both sides use exactly these. */
export const COMMANDS = {
	health: "health",
	appInfo: "app_info",
	appQuit: "app_quit",
	resourceUsage: "resource_usage",
	logWrite: "log_write",
	logsExport: "logs_export",
	dbVersionCheck: "db_version_check",
	shellRun: "shell_run",
	shellStart: "shell_start",
	shellCancel: "shell_cancel",
	shellLoginEnv: "shell_login_env",
	fsReadText: "fs_read_text",
	fsWriteTextAtomic: "fs_write_text_atomic",
	fsStat: "fs_stat",
	fsMkdirp: "fs_mkdirp",
	fsReadDir: "fs_read_dir",
	fsTrash: "fs_trash",
	fsPaths: "fs_paths",
	searchListTree: "search_list_tree",
	searchFuzzy: "search_fuzzy",
	searchGrep: "search_grep",
	ptySpawn: "pty_spawn",
	ptyWrite: "pty_write",
	ptyResize: "pty_resize",
	ptyKill: "pty_kill",
	ptyAck: "pty_ack",
	ptyScreenText: "pty_screen_text",
	ptyLoadHistory: "pty_load_history",
	sidecarEnsureStarted: "sidecar_ensure_started",
	sidecarSend: "sidecar_send",
	sidecarLogPath: "sidecar_log_path",
	keychainGet: "keychain_get",
	keychainSet: "keychain_set",
	keychainDelete: "keychain_delete",
	notify: "notify",
	setDockBadge: "set_dock_badge",
	revealInFinder: "reveal_in_finder",
	openWith: "open_with",
	installedApps: "installed_apps",
	speechAvailable: "speech_available",
	speechStart: "speech_start",
	speechStop: "speech_stop",
	speechCancel: "speech_cancel",
	updaterCheck: "updater_check",
	updaterInstall: "updater_install",
	updaterRelaunch: "updater_relaunch",
	attachmentMaterialize: "attachment_materialize",
	imageResize: "image_resize",
	menuSetShortcuts: "menu_set_shortcuts",
} as const;

/** Events emitted by the Rust shell. */
export const EVENTS = {
	quitRequested: "app://quit-requested",
	deepLink: "app://deep-link",
	shellDone: "shell://done",
	ptyExit: "pty://exit",
	sidecarLine: "sidecar://line",
	sidecarRestart: "sidecar://restart",
	notificationClicked: "notification://clicked",
	updaterStatus: "updater://status",
	menuCommand: "menu://command",
} as const;

// ---------------------------------------------------------------- errors (real)

/** Converts whatever Tauri rejected with into an `AppError`. */
export function toAppError(error: unknown): AppError {
	if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
		const { code, message } = error as { code: unknown; message: unknown };
		if (typeof code === "string" && typeof message === "string") return appError(code, message);
	}
	if (typeof error === "string") return appError("tauri_error", error);
	if (error instanceof Error) return appError("tauri_error", error.message, error);
	return appError("tauri_error", "The Rust shell returned an error that could not be read.", error);
}

/** Calls a command and turns a rejection into an `Err`. The one place that catches. */
export async function invokeResult<T>(
	bindings: Pick<TauriBindings, "invoke">,
	command: string,
	args?: Record<string, unknown>,
): Promise<Result<T>> {
	try {
		return ok(await bindings.invoke<T>(command, args));
	} catch (error) {
		return err(toAppError(error));
	}
}

/** The liveness check: the one command that is real in the scaffold. */
export async function checkHealth(bindings: Pick<TauriBindings, "invoke">): Promise<Result<void>> {
	const result = await invokeResult<string>(bindings, COMMANDS.health);
	if (!result.ok) return result;
	return result.value === "ok"
		? ok(undefined)
		: err(
				appError(
					"health_unexpected",
					`The Rust shell answered "${result.value}" to the health check.`,
				),
			);
}

// ---------------------------------------------------------------- groups (placeholders)

/** `app_info` -> `{ version, channel }`; `app_quit`; `resource_usage`; `log_write`; `logs_export`. Events: quit, deep link. */
export function createTauriAppInfo(
	bindings: TauriBindings,
	info: { version: string; channel: "dev" | "release" },
): AppInfo {
	return {
		version: info.version,
		channel: info.channel,
		health: () => checkHealth(bindings),
		dbVersionWarning: () => notImplemented("PLAT-17"),
		onDeepLink: () => notImplemented("PLAT-16"),
		onQuitRequested: () => notImplemented("PLAT-02"),
		quit: () => notImplemented("PLAT-02"),
		resourceUsage: () => notImplemented("PLAT-14"),
		writeLog: () => notImplemented("PLAT-18"),
		exportLogs: () => notImplemented("PLAT-18"),
	};
}

/**
 * tauri-plugin-sql: `Database.load("sqlite:conducted.db")`, then the pragmas named in the header.
 * `select` and `execute` map to the plugin's methods; `transaction` sends BEGIN IMMEDIATE and
 * COMMIT or ROLLBACK on one connection, queued behind any open transaction.
 */
export function createTauriDatabase(): Promise<Result<Database>> {
	return notImplemented("PLAT-02");
}

/** `shell_run { command }`, `shell_start { command }` + `shell_cancel { id }` + event `shell://done`, `shell_login_env`. */
export function createTauriShell(_bindings: TauriBindings): Shell {
	return {
		run: () => notImplemented("PLAT-03"),
		start: () => notImplemented("PLAT-03"),
		loginEnv: () => notImplemented("PLAT-04"),
	};
}

/** `fs_read_text { path }`, `fs_write_text_atomic { path, text }`, `fs_stat { path }`, `fs_mkdirp`, `fs_read_dir`, `fs_trash`, `fs_paths`. */
export function createTauriFileSystem(
	_bindings: TauriBindings,
	_paths: FileSystem["paths"],
): FileSystem {
	return {
		readText: () => notImplemented("PLAT-05"),
		writeTextAtomic: () => notImplemented("PLAT-05"),
		exists: () => notImplemented("PLAT-05"),
		stat: () => notImplemented("PLAT-05"),
		mkdirp: () => notImplemented("PLAT-05"),
		readDir: () => notImplemented("PLAT-05"),
		trash: () => notImplemented("PLAT-05"),
		paths: _paths,
	};
}

/** `search_list_tree { root }`, `search_fuzzy { root, query, limit }`, `search_grep { root, query, options }`. */
export function createTauriFileSearch(_bindings: TauriBindings): FileSearch {
	return {
		listTree: () => notImplemented("PLAT-06"),
		fuzzyMatch: () => notImplemented("PLAT-06"),
		grep: () => notImplemented("PLAT-06"),
	};
}

/** `pty_spawn { options, onData: Channel }`, `pty_write { id, data }`, `pty_resize`, `pty_kill`, `pty_ack { id, bytes }`, `pty_screen_text { id, maxLines }`, `pty_load_history { terminalId }`, event `pty://exit`. */
export function createTauriPty(_bindings: TauriBindings): Pty {
	return {
		spawn: () => notImplemented("PLAT-07"),
		loadHistory: () => notImplemented("PLAT-08"),
	};
}

/** `sidecar_ensure_started`, `sidecar_send { line }`, `sidecar_log_path`, events `sidecar://line` and `sidecar://restart`. */
export function createTauriSidecar(_bindings: TauriBindings): SidecarTransport {
	return {
		ensureStarted: () => notImplemented("PLAT-09"),
		send: () => notImplemented("PLAT-09"),
		onLine: () => notImplemented("PLAT-09"),
		onRestart: () => notImplemented("PLAT-09"),
		logPath: () => notImplemented("PLAT-09"),
	};
}

/** `keychain_get { key }`, `keychain_set { key, value }`, `keychain_delete { key }`. */
export function createTauriKeychain(_bindings: TauriBindings): Keychain {
	return {
		get: () => notImplemented("PLAT-10"),
		set: () => notImplemented("PLAT-10"),
		delete: () => notImplemented("PLAT-10"),
	};
}

/** `notify { title, body, deepLink }` (after a permission check with plugin-notification), `set_dock_badge { count }`, event `notification://clicked`. */
export function createTauriNotifications(_bindings: TauriBindings): Notifications {
	return {
		notify: () => notImplemented("PLAT-11"),
		setDockBadge: () => notImplemented("PLAT-11"),
		onClicked: () => notImplemented("PLAT-11"),
	};
}

/** plugin-dialog: `open({ directory: true })`, `open({ multiple })`, `ask`. */
export function createTauriDialogs(): Dialogs {
	return {
		pickFolder: () => notImplemented("PLAT-02"),
		pickFiles: () => notImplemented("PLAT-02"),
		confirm: () => notImplemented("PLAT-02"),
	};
}

/** plugin-opener: `openUrl`; `reveal_in_finder { path }`, `open_with { appName, path }`, `installed_apps`. */
export function createTauriOpener(_bindings: TauriBindings): Opener {
	return {
		openUrl: () => notImplemented("PLAT-02"),
		revealInFinder: () => notImplemented("PLAT-19"),
		openWith: () => notImplemented("PLAT-19"),
		installedApps: () => notImplemented("PLAT-19"),
	};
}

/** plugin-clipboard-manager: `writeText`, `writeImage`. */
export function createTauriClipboard(): Clipboard {
	return {
		writeText: () => notImplemented("PLAT-02"),
		writeImage: () => notImplemented("PLAT-02"),
	};
}

/** `speech_available`, `speech_start { onEvent: Channel }`, `speech_stop`, `speech_cancel`. */
export function createTauriSpeech(_bindings: TauriBindings): Speech {
	return {
		available: () => notImplemented("PLAT-12"),
		start: () => notImplemented("PLAT-12"),
		stop: () => notImplemented("PLAT-12"),
		cancel: () => notImplemented("PLAT-12"),
	};
}

/** `updater_check`, `updater_install`, `updater_relaunch`, event `updater://status`. */
export function createTauriUpdater(_bindings: TauriBindings): Updater {
	return {
		check: () => notImplemented("PLAT-13"),
		install: () => notImplemented("PLAT-13"),
		relaunch: () => notImplemented("PLAT-13"),
	};
}

/**
 * Builds the whole Platform. Order: health check, `app_info`, `fs_paths`, database load, then
 * the groups above. Returns the first failure as an `Err`.
 */
export function createTauriPlatform(_bindings: TauriBindings): Promise<Result<Platform>> {
	return notImplemented("PLAT-02");
}
