/**
 * The Platform interface: the only door between the web UI and the Rust shell.
 *
 * Only files in `src/platform/` may import `@tauri-apps/*` (enforced by biome.json). Services in
 * `src/core/` receive a Platform as a parameter, so tests can pass an in-memory stand-in that is
 * checked against the real one by a shared contract test (PLAT-01).
 *
 * Research: services-map.md 1.1 (Conductor's `vn()` Platform object), native-and-sidecar-map.md A2
 * (the Rust commands behind each group). The `cloud` group is the Rust shell's side of a cloud
 * workspace's connection (CLOUD-03) and of pairing this Mac with its Worker (CLOUD-07). Keeping the
 * Mac awake has no door of its own: PLAT-21 runs
 * `caffeinate` through `shell.start`.
 *
 * Every error code a method can answer with is in `PLATFORM_ERROR_CODES`, one list shared by the
 * Rust shell, the Tauri bridge and the in-memory stand-in. The contract test reads the Rust
 * sources, so a code the shell returns without being listed fails the test.
 */
import { type AppError, appError, type ManagedProgram, type Result } from "@conducted/shared";

// ---------------------------------------------------------------- error codes

/**
 * Every error code a Platform method can return. The Rust shell, the Tauri bridge and the
 * in-memory stand-in all answer with codes from this one list, so the stand-in cannot drift from
 * the real shell. The contract test reads the Rust sources and fails on a code that is missing.
 */
export const PLATFORM_ERROR_CODES = [
	"app_icon_failed",
	"artifact_read_failed",
	"attachment_app_data",
	"attachment_bad_data",
	"attachment_bad_destination",
	"attachment_decode_failed",
	"attachment_exists",
	"attachment_is_directory",
	"attachment_missing",
	"attachment_task_failed",
	"attachment_too_large",
	"attachment_write_failed",
	"binary_copy_failed",
	"binary_data_dir_failed",
	"binary_resources_dir_failed",
	"binary_verification_failed",
	"clipboard_unavailable",
	"cloud_bad_line",
	"cloud_data_privacy",
	"cloud_deploy_failed",
	"cloud_method_not_allowed",
	"cloud_not_a_worker",
	"cloud_not_paired",
	"cloud_pair_refused",
	"cloud_path_not_allowed",
	"cloud_relay_closed",
	"cloud_relay_failed",
	"cloud_relay_unknown",
	"cloud_request_failed",
	"cloud_resources_missing",
	"cloud_response_too_large",
	"cloud_token_invalid",
	"cloud_token_unreadable",
	"cloud_uninstall_failed",
	"cloud_unscripted",
	"cloud_url_not_allowed",
	"cloud_vm_id_invalid",
	"db_check_failed",
	"db_migration_failed",
	"db_open_failed",
	"db_path_unavailable",
	"db_read_failed",
	"db_version_unreadable",
	"deep_link_too_long",
	"deep_link_unavailable",
	"dock_badge_failed",
	"fs_asset_scope_failed",
	"fs_bad_data",
	"fs_bad_path",
	"fs_file_too_large",
	"fs_is_a_directory",
	"fs_no_home",
	"fs_not_a_directory",
	"fs_not_found",
	"fs_not_utf8",
	"fs_out_of_scope",
	"fs_path_unavailable",
	"fs_relative_path",
	"fs_scope_failed",
	"fs_task_failed",
	"full_disk_access_open_failed",
	"health_unexpected",
	"history_app_data",
	"history_bad_id",
	"history_clock",
	"history_decrypt_failed",
	"history_encrypt_failed",
	"history_evict_failed",
	"history_folder_failed",
	"history_key_invalid",
	"history_key_random",
	"history_list_failed",
	"history_load_task_failed",
	"history_not_found",
	"history_read_failed",
	"history_save_failed",
	"history_stat_failed",
	"history_unencrypted",
	"http_body_not_utf8",
	"http_cancelled",
	"http_checksum_invalid",
	"http_checksum_mismatch",
	"http_client_failed",
	"http_destination_invalid",
	"http_destination_missing",
	"http_duplicate_id",
	"http_header_not_text",
	"http_invalid_method",
	"http_invalid_url",
	"http_progress_failed",
	"http_response_too_large",
	"http_state_poisoned",
	"http_status",
	"http_unscripted",
	"http_url_not_allowed",
	"instance_lock_failed",
	"invalid_cursor",
	"io",
	"keychain_bad_key",
	"keychain_denied",
	"keychain_failed",
	"keychain_value_too_large",
	"log_bad_level",
	"log_data_dir_failed",
	"log_export_task_failed",
	"log_folder_failed",
	"log_not_running",
	"log_state_failed",
	"login_env_failed",
	"menu_accelerator_failed",
	"menu_event",
	"menu_item_missing",
	"microphone_denied",
	"navigation_guard",
	"network_status_failed",
	"network_watch_failed",
	"not_implemented",
	"notification_bad_link",
	"notification_denied",
	"notification_failed",
	"notification_permission",
	"open_failed",
	"open_with_missing_path",
	"open_with_not_installed",
	"open_with_unknown_app",
	"path_override_data_dir_failed",
	"path_override_invalid",
	"path_override_none",
	"path_override_prune_failed",
	"path_override_shim_failed",
	"path_override_unknown_program",
	"program_bin_dir_failed",
	"program_bin_shim_failed",
	"program_checksum_mismatch",
	"program_data_dir_failed",
	"program_install_failed",
	"program_metadata_failed",
	"program_prune_failed",
	"program_quarantine_failed",
	"program_read_failed",
	"program_release_invalid",
	"program_release_missing",
	"program_resources_dir_failed",
	"program_status_not_sent",
	"program_unpack_failed",
	"program_version_not_pinned",
	"port_forward_bind_failed",
	"port_forward_failed",
	"port_forward_invalid",
	"port_forward_no_port",
	"port_forward_reserved",
	"pty_ack_failed",
	"pty_bad_cwd",
	"pty_bad_size",
	"pty_not_found",
	"pty_resize_failed",
	"pty_spawn_failed",
	"pty_write_failed",
	"recording_failed",
	"resource_usage_failed",
	"search_bad_pattern",
	"search_bad_root",
	"search_failed",
	"search_read_failed",
	"search_task_failed",
	"search_tree_too_large",
	"search_walk_failed",
	"shell_bad_cwd",
	"shell_cancel_failed",
	"shell_cancelled",
	"shell_done_incomplete",
	"shell_duplicate_id",
	"shell_output_too_large",
	"shell_program_not_allowed",
	"shell_spawn_failed",
	"shell_timeout",
	"shell_unscripted",
	"shell_wait_failed",
	"sidecar_bad_line",
	"sidecar_binary_missing",
	"sidecar_connect_failed",
	"sidecar_data_dir_failed",
	"sidecar_exited_early",
	"sidecar_folder_failed",
	"sidecar_handshake_timeout",
	"sidecar_log_failed",
	"sidecar_not_running",
	"sidecar_not_started",
	"sidecar_pipe_failed",
	"sidecar_ps_failed",
	"sidecar_resources_dir_failed",
	"sidecar_socket_failed",
	"sidecar_spawn_failed",
	"sidecar_start_task_failed",
	"sidecar_stop_failed",
	"sidecar_version_check_failed",
	"sidecar_version_mismatch",
	"sidecar_write_failed",
	"system_info_failed",
	"tauri_binding_missing",
	"tauri_error",
	"traffic_lights_missing",
	"transaction_closed",
	"transaction_nested",
	"unavailable",
	"updater_data_dir",
	"updater_failed",
	"updater_install_failed",
	"updater_not_staged",
	"updater_nothing_pending",
	"updater_state_read",
	"updater_state_unreadable",
	"updater_state_write",
	"window_focus_failed",
	"window_main_thread_failed",
	"window_missing",
	"window_platform_unsupported",
	"window_vibrancy_failed",
] as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

/** An error whose code is a known Platform code. A code outside the list fails to compile. */
export function platformError(code: PlatformErrorCode, message: string, cause?: unknown): AppError {
	return appError(code, message, cause);
}

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
	/**
	 * Start from the login-shell environment as captured in `cwd`, so direnv and mise settings of
	 * that folder apply, instead of the app-wide capture. The first command in a folder waits for
	 * that folder's capture.
	 */
	envFromCwd?: boolean;
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
	/**
	 * The user's login shell and PATH. With `cwd`, as the login shell sees them in that folder,
	 * captured once per folder; without it, the app-wide capture made at startup. A relative `cwd`
	 * fails with `shell_bad_cwd`. `zdotdir` is the `ZDOTDIR` the app itself was launched with, or
	 * null; zsh reads the user's dotfiles from it (RUN-09).
	 */
	loginEnv(cwd?: string): Promise<{ shell: string; path: string; zdotdir: string | null }>;
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
	/**
	 * Reads a file's bytes, for a binary file that `readText` refuses (CLOUD-11). The same size
	 * limit as `readText` applies.
	 */
	readBytes(path: string): Promise<Result<Uint8Array>>;
	/** Writes to a temp file and renames it into place, so readers never see half a file. */
	writeTextAtomic(path: string, text: string): Promise<Result<void>>;
	/** Writes bytes atomically, for a binary file the mirror keeps (CLOUD-11). */
	writeBytes(path: string, bytes: Uint8Array): Promise<Result<void>>;
	exists(path: string): Promise<boolean>;
	stat(path: string): Promise<Result<FileStat>>;
	mkdirp(path: string): Promise<Result<void>>;
	readDir(path: string): Promise<Result<FileStat[]>>;
	/** Moves to the macOS Trash. The app never deletes user files for good. */
	trash(path: string): Promise<Result<void>>;
	/**
	 * Lets the file commands reach `path` and everything below it until the app quits (PLAT-02).
	 * Without it they reach only the app's own folders, the Claude configuration and
	 * `~/conducted`, and refuse anything else with `fs_out_of_scope`. The project and workspace
	 * services register their folders whenever they add or load them. The folder need not exist
	 * yet. A relative path is an Err with `fs_relative_path`.
	 */
	registerRoot(path: string): Promise<Result<void>>;
	/**
	 * A URL the web view can load a local file from, for image, PDF and video previews. The Rust
	 * shell serves only files under a registered folder or the attachment draft folder; any other
	 * file fails to load the way a missing one does.
	 */
	assetUrl(path: string): string;
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
export interface ArtifactPage {
	/** Files (never folders) of the workspace's `.context` folder, as absolute paths. */
	entries: FileStat[];
	/** Pass back to get the next page. Null on the last page. */
	nextCursor: string | null;
	/**
	 * How many files of the whole folder the list leaves out: the `.context` files the app keeps
	 * for itself (file_search.rs). Every page carries the same total.
	 */
	omitted: number;
}

export interface FileSearch {
	listTree(root: string): Promise<Result<TreeEntry[]>>;
	/** One page of the Artifacts tab: the workspace's `.context` folder, newest first (REV-10). */
	listArtifacts(
		workspacePath: string,
		options: { cursor: string | null; limit: number },
	): Promise<Result<ArtifactPage>>;
	fuzzyMatch(root: string, query: string, limit: number): Promise<Result<TreeEntry[]>>;
	grep(
		root: string,
		query: string,
		options: { caseSensitive: boolean; wholeWord: boolean; regex: boolean; limit: number },
	): Promise<Result<GrepMatch[]>>;
}

// ---------------------------------------------------------------- terminals

export interface PtySpawn {
	/** The terminal row's id, which names its saved scrollback so a reopened terminal finds it. */
	terminalId: string;
	cwd: string;
	cols: number;
	rows: number;
	/** Run this program instead of an interactive login shell (setup and run scripts). */
	command?: { program: string; args: readonly string[] };
	env?: Readonly<Record<string, string>>;
	/**
	 * Most bytes of output kept for the terminal's saved history: the Advanced setting "terminal
	 * scrollback limit" (PLAT-08). Rust never keeps more than 20 MiB for one terminal.
	 */
	scrollbackLimitBytes?: number;
}

export interface PtyHandle {
	readonly id: string;
	write(data: string): Promise<void>;
	resize(cols: number, rows: number): Promise<void>;
	kill(): Promise<void>;
	/** Output arrives in chunks. Call `ack` with the byte count once rendered (flow control). */
	onData(listener: (chunk: Uint8Array) => void): Unsubscribe;
	/** An Err means the shell did not hear it, so output may stay paused. */
	ack(bytes: number): Promise<Result<void>>;
	/**
	 * The process ended. `historyError` says why its saved history could not be written, and is
	 * null when it was written or there was nothing to save (PLAT-08).
	 */
	onExit(listener: (exitCode: number | null, historyError: AppError | null) => void): Unsubscribe;
	/** Plain text of the visible screen plus scrollback, for the GetTerminalOutput tool. */
	screenText(maxLines: number): Promise<string>;
	/** The full screen state, so a tab or a restored terminal redraws on the right screen. */
	screenSnapshot(): Promise<Result<ScreenSnapshot>>;
}

/** What a terminal needs to redraw exactly: its contents and the modes the program set. */
export interface ScreenSnapshot {
	/** Escape sequences that redraw the screen and scrollback when written to a fresh terminal. */
	data: string;
	cols: number;
	rows: number;
	/** A full-screen program (vim, less) switched to the alternate screen. */
	alternateScreen: boolean;
	/** The program asked for bracketed paste. */
	bracketedPaste: boolean;
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
	/**
	 * Sends one line. The line holds no newline: the transport adds it, and refuses a line with a
	 * newline in it (Err `sidecar_bad_line`).
	 */
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
	/** The system save dialog. Null when the user cancels. */
	pickSavePath(options: { title: string; defaultPath?: string }): Promise<string | null>;
	confirm(options: { title: string; message: string; okLabel: string }): Promise<boolean>;
}

export interface Opener {
	openUrl(url: string): Promise<void>;
	revealInFinder(path: string): Promise<void>;
	/** Opens a folder or file in another app, e.g. "Cursor", "Visual Studio Code", "Ghostty". */
	openWith(appName: string, path: string): Promise<Result<void>>;
	installedApps(): Promise<string[]>;
	/**
	 * A known app's own icon as a PNG data URL, read once and cached by the Rust shell. Null when
	 * the app is not installed or its bundle names no icon file.
	 */
	appIcon(appName: string): Promise<Result<string | null>>;
}

export interface Clipboard {
	writeText(text: string): Promise<void>;
	writeImage(pngBytes: Uint8Array): Promise<void>;
	/** The files copied in Finder, as absolute paths in order. Empty when none are copied. */
	readFilePaths(): Promise<Result<string[]>>;
}

/** One message from dictation, as speech.rs sends it. `ended` is always the last one. */
export type SpeechEvent =
	/** Text so far for the current phrase. Replaces the previous partial text. */
	| { kind: "partial"; text: string }
	/** A finished phrase. It does not change again. */
	| { kind: "final"; text: string }
	/** Input loudness from 0 to 1, for the level meter. */
	| { kind: "level"; value: number }
	/** Something failed, for example code "microphone_denied" or "unavailable". `ended` follows. */
	| { kind: "error"; code: string; message: string }
	| { kind: "ended" };

/** Apple on-device dictation (speech.rs). */
export interface Speech {
	available(): Promise<boolean>;
	start(onEvent: (event: SpeechEvent) => void): Promise<Result<void>>;
	/** Ends dictation. The final text arrives before `ended`, within 5 seconds. */
	stop(): Promise<void>;
	cancel(): Promise<void>;
}

export interface Updater {
	check(): Promise<Result<{ version: string; notes: string } | null>>;
	/** Downloads and installs; the app restarts when every agent is idle. */
	install(): Promise<Result<void>>;
	relaunch(): Promise<void>;
	/** The update installed just before this launch, so its release notes can be shown once. */
	installedUpdate(): Promise<Result<{ version: string; notes: string } | null>>;
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
	/**
	 * Null when the database schema is one this app knows. Otherwise the versions, and startup
	 * stops with a "database is newer than this app" screen (PLAT-17).
	 */
	dbVersionWarning(): Promise<Result<{ databaseVersion: number; appVersion: number } | null>>;
	onDeepLink(listener: (url: string) => void): Unsubscribe;
	/**
	 * A link the Rust shell refused before the UI's parser saw it, such as one over 64 KiB
	 * (PLAT-16). The links that launched the app are checked when this subscribes.
	 */
	onDeepLinkRejected(listener: (rejection: AppError) => void): Unsubscribe;
	onQuitRequested(listener: () => void): Unsubscribe;
	quit(): Promise<void>;
	/**
	 * CPU and memory of the app's own processes (PLAT-14). A process belongs to the longest of
	 * `workspacePaths` its working folder lies in; one in none of them has no `workspacePath`.
	 */
	resourceUsage(workspacePaths: readonly string[]): Promise<Result<ProcessUsage[]>>;
	writeLog(level: "error" | "warn" | "info" | "debug", message: string, data?: unknown): void;
	/** Changes how much the Rust shell writes to the log, at run time. */
	setLogLevel(level: "error" | "warn" | "info" | "debug"): Promise<void>;
	exportLogs(): Promise<Result<string>>;
	/**
	 * Tells the Rust shell the UI listens for quit requests. A quit asked for earlier is held
	 * until then, so it is never lost.
	 */
	setQuitHandlerReady(): Promise<void>;
}

// ---------------------------------------------------------------- window, menu and system

/** A file drag over the window, with the real paths of the files. Positions are in pixels. */
export type FileDropEvent =
	| { kind: "enter"; paths: string[]; x: number; y: number }
	| { kind: "over"; x: number; y: number }
	| { kind: "leave" }
	| { kind: "drop"; paths: string[]; x: number; y: number };

export interface AppWindow {
	isFocused(): Promise<boolean>;
	/** Fires when the window gains or loses focus. Polls and update checks follow it. */
	onFocusChanged(listener: (focused: boolean) => void): Unsubscribe;
	/** File drags from Finder. The webview never navigates to a dropped file. */
	onFileDrop(listener: (event: FileDropEvent) => void): Unsubscribe;
	/** Zooms the whole webview. 1 is 100 percent. */
	setZoom(factor: number): Promise<Result<void>>;
	/** Turns the translucent window background (macOS vibrancy) on or off. */
	setVibrancy(enabled: boolean): Promise<Result<void>>;
	/** Moves the close, minimise and zoom buttons, in pixels from the top left corner. */
	setTrafficLightPosition(x: number, y: number): Promise<Result<void>>;
	/** The window's appearance. Null follows macOS. */
	setTheme(theme: "light" | "dark" | null): Promise<void>;
	/** Opens or closes the web inspector. */
	toggleInspector(): Promise<void>;
}

/** One accelerator for a menu item, keyed by command id. Null clears it. */
export interface MenuShortcut {
	commandId: string;
	/** A Tauri accelerator string, for example "CmdOrCtrl+Shift+P". */
	accelerator: string | null;
}

export interface AppMenu {
	/** Puts the command registry's bindings on the menu items. */
	setShortcuts(
		shortcuts: readonly MenuShortcut[],
	): Promise<Result<{ applied: string[]; rejected: string[] }>>;
	/** Fires with the command id when the user picks a menu item. */
	onCommand(listener: (commandId: string) => void): Unsubscribe;
}

export interface SystemInfo {
	/** The macOS version, for example "15.4.1". */
	osVersion: string;
	/** The CPU of the Mac. */
	machineArch: "arm64" | "x86_64";
	/** The CPU this build was made for. An x86_64 build on an arm64 Mac runs under Rosetta. */
	buildArch: "arm64" | "x86_64";
}

export interface SystemFacts {
	info(): Promise<SystemInfo>;
	isOnline(): Promise<boolean>;
	/** Fires when the Mac goes offline or comes back online. */
	onNetworkChanged(listener: (online: boolean) => void): Unsubscribe;
	/** Whether the app has Full Disk Access, so agents stop asking for folder access. */
	hasFullDiskAccess(): Promise<boolean>;
	/** Opens System Settings at Privacy & Security, Full Disk Access. */
	openFullDiskAccessSettings(): Promise<Result<void>>;
}

// ---------------------------------------------------------------- attachments

/** A file copied into app storage for a chat. */
export interface MaterializedFile {
	path: string;
	sizeBytes: number;
	/** The contents are a still image the app can show. */
	isImage: boolean;
	width: number | null;
	height: number | null;
	/** The copy was shrunk to fit the size limits for agents. */
	resized: boolean;
}

/** attachments.rs: copy and shrink in Rust, so large files never cross into the webview. */
export interface AttachmentFiles {
	materialize(
		sourcePath: string,
		destinationPath: string,
		options: { resizeImage: boolean },
	): Promise<Result<MaterializedFile>>;
	resizeImage(sourcePath: string, destinationPath: string): Promise<Result<MaterializedFile>>;
	/**
	 * Writes bytes the web view holds, such as a pasted image, to `destinationPath`. The same rules
	 * as `materialize` apply: the destination lies in the attachment draft folder and is new, and
	 * an image is shrunk when `resizeImage` is set.
	 */
	writeBytes(
		bytes: Uint8Array,
		destinationPath: string,
		options: { resizeImage: boolean },
	): Promise<Result<MaterializedFile>>;
}

// ---------------------------------------------------------------- programs the app manages (D021, D024)

export type ProgramState =
	| "missing"
	| "queued"
	| "downloading"
	| "verifying"
	| "retrying"
	| "ready"
	| "failed";

export interface ProgramStatus {
	program: ManagedProgram;
	state: ProgramState;
	/** The version in use, or the one being installed. */
	version: string | null;
	bytesDownloaded: number;
	bytesTotal: number | null;
	/** Which attempt this is. Counts up after each failure. */
	attempt: number;
	/** When the next automatic attempt starts, in milliseconds since the epoch. */
	nextAttemptAt: number | null;
	error: string | null;
	/** Where the managed copy is. Null until one is installed. */
	path: string | null;
}

/** binaries.rs: downloads official releases, checks their checksums, keeps one version of each. */
export interface Programs {
	statuses(): Promise<Result<ProgramStatus[]>>;
	/** Fires on every change of one program's status, including download progress. */
	onStatus(listener: (status: ProgramStatus) => void): Unsubscribe;
	/** Downloads and installs the version this app pins. Also the Retry after a failure. */
	install(program: ManagedProgram): Promise<Result<void>>;
	/** Downloads the current version again, replacing the installed copy. */
	redownload(program: ManagedProgram): Promise<Result<void>>;
	/** Moves the managed copy to the Trash. */
	remove(program: ManagedProgram): Promise<Result<void>>;
	/** Downloads, in the background, the versions the next app update pins. */
	prefetchForUpdate(): Promise<Result<void>>;
	/** Programs whose copy failed the launch check, with the reason in plain words. */
	verificationErrors(): Promise<{ program: ManagedProgram; message: string }[]>;
	/**
	 * Points the PATH shims at the programs the user chose in settings and returns the folder to
	 * put first on PATH, so terminals and scripts run the same programs as the agents (SET-13).
	 */
	syncPathOverrides(overrides: Partial<Record<ManagedProgram, string>>): Promise<Result<string>>;
}

// ---------------------------------------------------------------- HTTP from Rust

export interface HttpRequest {
	url: string;
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	headers?: Readonly<Record<string, string>>;
	body?: string;
	/** Stops the request after this many milliseconds. Catches hangs, not slowness. */
	timeoutMs?: number;
}

export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

export interface HttpDownload {
	readonly id: string;
	/** The file is complete and, when a checksum was given, matches it. */
	readonly done: Promise<Result<{ path: string; sizeBytes: number; sha256: string }>>;
	cancel(): Promise<void>;
}

// ---------------------------------------------------------------- cloud

/** One request to the user's Worker. The Rust shell adds the pairing token from the Keychain. */
export interface CloudRequest {
	/** The Worker's base URL, for example "https://conducted.example.workers.dev". */
	url: string;
	method: "GET" | "POST";
	/** The route inside that Worker, for example "/w/oslo/git". */
	path: string;
	body?: unknown;
	timeoutMs?: number;
}

/** The Worker's answer, whatever its status, so the caller can read the Worker's own error. */
export interface CloudResponse {
	status: number;
	body: string;
}

/** What the Mac knows about its pairing. The token is never part of it. */
export interface CloudPairing {
	/** True when the Keychain holds a pairing token. */
	paired: boolean;
	/** The Worker the Mac paired with. Null when it is not paired. */
	url: string | null;
}

/** A Worker URL and its token, as the pairing form typed them. */
export interface CloudPairInput {
	url: string;
	token: string;
}

/**
 * What a deploy may override (CLOUD-08). The UI sends nothing, so the app's bundled name is used;
 * a test may name one and delete everything after.
 */
export interface CloudDeployInput {
	workerName?: string;
}

/** What a completed deploy leaves: the Worker's URL, now paired with this Mac. */
export interface CloudDeployResult {
	url: string;
}

/** What an uninstall overrides: the same optional name a deploy used. */
export type CloudUninstallInput = CloudDeployInput;

/** The line transport to the sidecar inside one workspace's sandbox (CLOUD-03). */
export interface CloudRelay {
	readonly id: string;
	/** Sends one line; a line with a newline is refused. */
	send(line: string): Promise<Result<void>>;
	onLine(listener: (line: string) => void): Unsubscribe;
	/** Fires once when the Worker or the network ends the relay. */
	onClosed(listener: (reason: string) => void): Unsubscribe;
	/** Closes the relay. A relay the Worker already ended is a no-op. */
	close(): Promise<void>;
}

/**
 * cloud.rs: the Rust shell owns the cloud connection because the web view cannot set a WebSocket
 * header (CLOUD-03). The pairing token never reaches the web view.
 */
export interface Cloud {
	/** The saved pairing: whether there is a token and the Worker it belongs to (CLOUD-07). */
	status(): Promise<Result<CloudPairing>>;
	/**
	 * Checks the URL and token with the Worker, then keeps both in the Keychain. The token is
	 * never returned, logged or put in an event (CLOUD-07).
	 */
	pair(input: CloudPairInput): Promise<Result<CloudPairing>>;
	/** Removes the saved pairing. A Mac that is not paired succeeds. */
	unpair(): Promise<Result<void>>;
	/**
	 * Deploys the Worker, its container application and its R2 bucket to the user's own Cloudflare
	 * account with their `wrangler` login, sets the pairing token as a Worker secret, and pairs
	 * this Mac (CLOUD-08). The token is made in Rust and never reaches the web view.
	 */
	deploy(input?: CloudDeployInput): Promise<Result<CloudDeployResult>>;
	/**
	 * Deletes what the deploy made, in the order that stops billing: the Worker, its container
	 * application and images, then the R2 bucket. It also removes this Mac's pairing (CLOUD-08).
	 */
	uninstall(input?: CloudUninstallInput): Promise<Result<void>>;
	request(request: CloudRequest): Promise<Result<CloudResponse>>;
	/**
	 * Opens one line stream into the workspace's Durable Object. `channel` selects the sidecar
	 * relay (the default) or a terminal's byte stream, which carries base64 JSON lines (CLOUD-09).
	 */
	openRelay(input: {
		url: string;
		vmId: string;
		channel?: "rpc" | "terminal";
	}): Promise<Result<CloudRelay>>;
}

/** One running local listener that carries a cloud workspace's port to the Mac (CLOUD-10). */
export interface PortForwardInfo {
	forwardId: string;
	localPort: number;
	remotePort: number;
}

/** What a port forward reports. `kind` is "started", "stopped" or "error". */
export interface PortForwardEvent {
	forwardId: string;
	kind: "started" | "stopped" | "error";
	message: string | null;
}

/**
 * port_forward.rs: the Rust shell owns the local TCP listeners, because the web view cannot open a
 * socket and cannot set the tunnel's Authorization header (CLOUD-10). The pairing token stays in
 * Rust, so a forward needs no token from the screen.
 */
export interface PortForwarding {
	/** The first free loopback port at `preferredPort`, then inside the range. */
	findAvailableLocalPort(input: {
		preferredPort?: number;
		excludedPorts?: number[];
		rangeStart: number;
		rangeEnd: number;
	}): Promise<Result<number>>;
	/** Binds the local port before returning, so a good answer means the Mac port is open. */
	start(input: {
		forwardId: string;
		url: string;
		vmId: string;
		localPort: number;
		remotePort: number;
	}): Promise<Result<PortForwardInfo>>;
	stop(forwardId: string): Promise<Result<void>>;
	list(): Promise<Result<PortForwardInfo[]>>;
	onEvent(listener: (event: PortForwardEvent) => void): Unsubscribe;
}

/** http.rs: requests go through the system proxy settings and a URL allow-list. */
export interface Http {
	fetch(request: HttpRequest): Promise<Result<HttpResponse>>;
	download(input: {
		url: string;
		destinationPath: string;
		/** Hex SHA-256 the file must have. A mismatch fails the download and removes the file. */
		expectedSha256?: string;
		onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
	}): HttpDownload;
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
	window: AppWindow;
	menu: AppMenu;
	system: SystemFacts;
	attachments: AttachmentFiles;
	programs: Programs;
	http: Http;
	cloud: Cloud;
	portForward: PortForwarding;
}
