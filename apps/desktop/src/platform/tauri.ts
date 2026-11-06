/**
 * @feature PLAT-02 Tauri implementation of the Platform interface
 * Owns: the one place that talks to Tauri. Every `Platform` group is built here from the command
 * names in docs/plans/tauri-commands.md and from the Tauri plugins (sql, dialog, clipboard,
 * deep-link, opener, notification). Only this folder may import `@tauri-apps/*`.
 * Behaviour: services-map.md 1.1 (Conductor's Platform object: the only code that touches
 * Tauri), native-and-sidecar-map.md A2 (the commands behind each group), docs/plans/
 * tauri-commands.md (command names, camelCase arguments, `Result<T, CommandError>`).
 * Must handle: a Rust command rejects with `{ code, message }`; a plugin rejects with a string or
 * an Error; both become `AppError` values for every method that returns a `Result`. The methods
 * whose interface type has no `Result` throw the `AppError` instead (`shell.loginEnv`, the `pty`
 * handle's `write`, `resize`, `kill` and `screenText`, `sidecar.logPath`) or let the plugin's
 * rejection through (`dialogs`, `opener.openUrl`, `clipboard`). `fs.exists` answers false when
 * the command fails. Binary data (terminal output, images) crosses as base64 strings or a
 * Channel, never as number arrays; event listeners return an unsubscribe function that can be
 * called twice, and one called before the listen call resolves releases the listener as soon as
 * it does; a listen call that fails leaves the subscription silent, because the interface has no
 * way to report it; `pty.spawn` passes a Channel for streamed output and listens for the exit
 * event before it spawns, so a command that ends at once still reports its exit; a command that is slower
 * than its `timeoutMs` is the Rust side's job (it kills the process group); the database opens
 * `sqlite:conducted.db` through the sql plugin and must run `PRAGMA journal_mode = WAL` and
 * `PRAGMA foreign_keys = ON` on its connection before the first statement; the database opens on
 * its first statement so the startup version check runs before the migrator; `Database.transaction`
 * must serialise: every statement goes through one queue, and a transaction holds it from
 * BEGIN IMMEDIATE to COMMIT or ROLLBACK, so only one statement uses the plugin's pool at a time
 * and the lazily grown pool does not open a second connection while the transaction is open.
 * An explicit pool pin is PLAT-27. A write also clears merged selects that were in flight, so a
 * read asked for after it cannot get a pre-write result. The handle a transaction passes to its
 * work rejects with `transaction_closed` once the transaction has ended.
 * Our design choice: the group builders take a `TauriBindings` value instead of importing `invoke`
 * themselves, so the helpers below can be tested without a webview. `realTauriBindings` is the
 * only place that holds the real functions. The argument names of each command are listed in
 * the doc comment above its builder; the Rust side must match them.
 * Test first: toAppError turns `{ code: "io", message: "no such file" }` into the same AppError,
 * and a plain string into code `tauri_error`.
 */

import {
	type AppError,
	appError,
	err,
	type ManagedProgram,
	notImplemented,
	ok,
	type Result,
} from "@conducted/shared";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	writeImage as writeClipboardImage,
	writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import {
	ask as askDialog,
	open as openDialog,
	save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { openUrl as openUrlInDefaultApp } from "@tauri-apps/plugin-opener";
import Sql from "@tauri-apps/plugin-sql";
import type {
	AppInfo,
	AppMenu,
	AppWindow,
	ArtifactPage,
	AttachmentFiles,
	Clipboard,
	Database,
	Dialogs,
	FileDropEvent,
	FileSearch,
	FileStat,
	FileSystem,
	GrepMatch,
	Http,
	HttpResponse,
	Keychain,
	Notifications,
	Opener,
	Platform,
	ProgramStatus,
	Programs,
	Pty,
	PtyHandle,
	PtySpawn,
	ScreenSnapshot,
	Shell,
	ShellOutput,
	SidecarTransport,
	Speech,
	SpeechEvent,
	SystemFacts,
	SystemInfo,
	TreeEntry,
	Updater,
} from "./platform.ts";
import {
	createQueuedDatabase,
	DATABASE_PRAGMAS,
	type QueuedDatabaseOptions,
	type SqlDatabase,
} from "./queued-database.ts";

// ---------------------------------------------------------------- bindings

/** The database handle tauri-plugin-sql returns. It lives in `queued-database.ts`. */
export type { SqlDatabase };

export interface TauriDialogBindings {
	open(options: {
		title?: string;
		defaultPath?: string;
		directory?: boolean;
		multiple?: boolean;
	}): Promise<string | string[] | null>;
	save(options: { title?: string; defaultPath?: string }): Promise<string | null>;
	ask(message: string, options?: { title?: string; okLabel?: string }): Promise<boolean>;
}

export interface TauriClipboardBindings {
	writeText(text: string): Promise<void>;
	writeImage(image: Uint8Array): Promise<void>;
}

export interface TauriOpenerBindings {
	openUrl(url: string): Promise<void>;
}

/** One drag and drop event from Tauri's window API. Positions are physical pixels. */
export type TauriDragDropEvent =
	| { type: "enter"; paths: string[]; position: { x: number; y: number } }
	| { type: "over"; position: { x: number; y: number } }
	| { type: "drop"; paths: string[]; position: { x: number; y: number } }
	| { type: "leave" };

export interface TauriWindowBindings {
	isFocused(): Promise<boolean>;
	listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>;
	onDragDropEvent(handler: (event: TauriDragDropEvent) => void): Promise<UnlistenFn>;
}

export interface TauriBindings {
	invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
	listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>;
	/** The current window. Focus events arrive on it, not on the app-wide event bus. */
	window?: TauriWindowBindings;
	/** tauri-plugin-sql, present on the real bindings and in a test that opens a database. */
	sql?: { load(path: string): Promise<SqlDatabase> };
	/** tauri-plugin-dialog. */
	dialog?: TauriDialogBindings;
	/** tauri-plugin-clipboard-manager. */
	clipboard?: TauriClipboardBindings;
	/** tauri-plugin-opener. */
	opener?: TauriOpenerBindings;
}

/**
 * Decodes encoded image bytes to the raw RGBA the clipboard plugin needs. The web view already
 * has a PNG decoder, so this needs no extra Rust feature or crate.
 */
async function decodeImageToRgba(
	encoded: Uint8Array,
): Promise<{ rgba: Uint8Array; width: number; height: number }> {
	const copy = new Uint8Array(encoded.byteLength);
	copy.set(encoded);
	const bitmap = await createImageBitmap(new Blob([copy.buffer], { type: "image/png" }));
	try {
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext("2d");
		if (context === null) throw new Error("The web view has no 2D canvas context.");
		context.drawImage(bitmap, 0, 0);
		const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
		return { rgba: new Uint8Array(data), width: bitmap.width, height: bitmap.height };
	} finally {
		bitmap.close();
	}
}

export const realTauriBindings: TauriBindings = {
	invoke: (command, args) => invoke(command, args),
	listen: (event, handler) => listen(event, (e) => handler(e.payload as never)),
	window: {
		isFocused: () => getCurrentWindow().isFocused(),
		listen: (event, handler) =>
			getCurrentWindow().listen(event, (e) => handler(e.payload as never)),
		onDragDropEvent: (handler) =>
			getCurrentWindow().onDragDropEvent((event) => handler(event.payload)),
	},
	sql: { load: (path) => Sql.load(path) as Promise<SqlDatabase> },
	dialog: {
		open: (options) => openDialog(options) as Promise<string | string[] | null>,
		save: (options) => saveDialog(options),
		ask: (message, options) => askDialog(message, options),
	},
	clipboard: {
		writeText: writeClipboardText,
		writeImage: async (pngBytes) => {
			const { rgba, width, height } = await decodeImageToRgba(pngBytes);
			const image = await Image.new(rgba, width, height);
			try {
				await writeClipboardImage(image);
			} finally {
				await image.close();
			}
		},
	},
	opener: { openUrl: openUrlInDefaultApp },
};

/** A binding that a builder needs but the caller left out is a programmer error, not a runtime one. */
function requireBinding<T>(value: T | undefined, name: string): T {
	if (value === undefined) throw new Error(`The Tauri ${name} binding is required.`);
	return value;
}

/**
 * Listens for an event and returns an unsubscribe function straight away. A listener that resolves
 * after the caller unsubscribed is released at once, so no listener leaks.
 */
interface EventSource {
	listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>;
}

function subscribe<T>(
	start: (handler: (payload: T) => void) => Promise<UnlistenFn>,
	handler: (payload: T) => void,
): () => void {
	let active = true;
	let unlisten: UnlistenFn | null = null;
	void start((payload) => {
		if (active) handler(payload);
	})
		.then((stop) => {
			if (active) unlisten = stop;
			else stop();
		})
		.catch(() => {
			// The Platform interface cannot return an error from a subscription. A failed
			// listener leaves the app running, and the caller can try again.
		});
	return () => {
		active = false;
		if (unlisten !== null) {
			unlisten();
			unlisten = null;
		}
	};
}

function onEvent<T>(
	bindings: EventSource,
	event: string,
	handler: (payload: T) => void,
): () => void {
	return subscribe((listener) => bindings.listen<T>(event, listener), handler);
}

/** Turns one Tauri drag event into the Platform's event, with its real paths and pixel position. */
function toFileDropEvent(event: TauriDragDropEvent): FileDropEvent {
	switch (event.type) {
		case "enter":
			return {
				kind: "enter",
				paths: [...event.paths],
				x: event.position.x,
				y: event.position.y,
			};
		case "over":
			return { kind: "over", x: event.position.x, y: event.position.y };
		case "drop":
			return {
				kind: "drop",
				paths: [...event.paths],
				x: event.position.x,
				y: event.position.y,
			};
		case "leave":
			return { kind: "leave" };
	}
}

// ---------------------------------------------------------------- names (docs/plans/tauri-commands.md)

/**
 * Command names registered by the Rust shell. Both sides use exactly these. A name the shell does
 * not register yet carries the id of its backlog row in a trailing comment; the structure guard
 * fails a name with no handler whose row is done.
 */
export const COMMANDS = {
	health: "health",
	appInfo: "app_info",
	appQuit: "app_quit",
	resourceUsage: "resource_usage",
	logWrite: "log_write",
	logsExport: "logs_export",
	logSetLevel: "log_set_level",
	setQuitHandlerReady: "set_quit_handler_ready",
	systemInfo: "system_info",
	networkStatus: "network_status", // PLAT-26
	fullDiskAccessCheck: "full_disk_access_check", // PLAT-24
	fullDiskAccessOpenSettings: "full_disk_access_open_settings", // PLAT-24
	windowSetVibrancy: "window_set_vibrancy", // PLAT-23
	windowSetTrafficLights: "window_set_traffic_lights", // PLAT-23
	windowToggleInspector: "window_toggle_inspector",
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
	searchListArtifacts: "search_list_artifacts", // REV-10
	ptySpawn: "pty_spawn",
	ptyWrite: "pty_write",
	ptyResize: "pty_resize",
	ptyKill: "pty_kill",
	ptyAck: "pty_ack",
	ptyScreenText: "pty_screen_text",
	ptyScreenSnapshot: "pty_screen_snapshot",
	ptyLoadHistory: "pty_load_history",
	sidecarEnsureStarted: "sidecar_ensure_started",
	sidecarSend: "sidecar_send",
	sidecarLogPath: "sidecar_log_path",
	keychainGet: "keychain_get",
	keychainSet: "keychain_set",
	keychainDelete: "keychain_delete",
	notify: "notify",
	setDockBadge: "set_dock_badge",
	notificationTakePending: "notification_take_pending",
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
	updaterInstalledUpdate: "updater_installed_update", // PLAT-13
	attachmentMaterialize: "attachment_materialize",
	imageResize: "image_resize",
	menuSetShortcuts: "menu_set_shortcuts",
	programsState: "programs_state", // PLAT-28
	programInstall: "program_install", // PLAT-28
	programRedownload: "program_redownload", // PLAT-28
	programRemove: "program_remove", // PLAT-28
	programsPrefetch: "programs_prefetch", // PLAT-28
	programsVerificationErrors: "programs_verification_errors",
	programsSyncPathOverrides: "programs_sync_path_overrides", // SET-13
	httpFetch: "http_fetch", // PLAT-30
	httpDownload: "http_download", // PLAT-30
	httpCancel: "http_cancel", // PLAT-30
} as const;

/** Events emitted by the Rust shell and by Tauri's own window. */
export const EVENTS = {
	windowFocus: "tauri://focus",
	windowBlur: "tauri://blur",
	quitRequested: "app://quit-requested",
	deepLink: "app://deep-link",
	shellDone: "shell://done",
	ptyExit: "pty://exit",
	sidecarLine: "sidecar://line",
	sidecarRestart: "sidecar://restart",
	notificationClicked: "notification://clicked",
	updaterStatus: "updater://status",
	menuCommand: "menu://command",
	networkChanged: "network://changed",
	programsStatus: "programs://status",
	programsVerificationErrors: "programs://verification-errors",
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

/** The answer of `db_version_check` in Rust (apps/desktop/src-tauri/src/db.rs). */
interface DbVersionCheck {
	state: "ok" | "fresh" | "failed_migration" | "database_newer";
	appVersion: number;
	dbVersion: number | null;
	message: string | null;
}

/** `app_info` -> `{ version, channel }`; `app_quit`; `resource_usage`; `log_write`; `log_set_level { level }`; `logs_export`; `set_quit_handler_ready`; `db_version_check`. Events: quit, deep link. */
export function createTauriAppInfo(
	bindings: TauriBindings,
	info: { version: string; channel: "dev" | "release" },
): AppInfo {
	return {
		version: info.version,
		channel: info.channel,
		health: () => checkHealth(bindings),
		dbVersionWarning: async () => {
			const checked = await invokeResult<DbVersionCheck>(bindings, COMMANDS.dbVersionCheck);
			if (!checked.ok) return checked;
			const { state, dbVersion, appVersion, message } = checked.value;
			if (state === "database_newer") {
				if (dbVersion === null) {
					return err(
						appError(
							"db_version_unreadable",
							message ?? "The database version could not be read, so startup cannot continue.",
						),
					);
				}
				return ok({ databaseVersion: dbVersion, appVersion });
			}
			if (state === "failed_migration") {
				return err(
					appError(
						"db_migration_failed",
						message ?? "A database upgrade did not finish, so startup cannot continue.",
					),
				);
			}
			return ok(null);
		},
		onDeepLink: () => notImplemented("PLAT-16"),
		onQuitRequested: (listener) => onEvent(bindings, EVENTS.quitRequested, () => listener()),
		quit: async () => {
			await invokeResult(bindings, COMMANDS.appQuit);
		},
		resourceUsage: () => notImplemented("PLAT-14"),
		writeLog: (level, message, data) => {
			const safe = serialisableLogData(data);
			const args =
				safe === undefined
					? { record: { level, message } }
					: { record: { level, message, data: safe } };
			void bindings.invoke(COMMANDS.logWrite, args).catch((error: unknown) => {
				console.error("Could not write an app log line", error);
			});
		},
		setLogLevel: async (level) => {
			const result = await invokeResult<void>(bindings, COMMANDS.logSetLevel, { level });
			if (!result.ok) throw result.error;
		},
		exportLogs: () => invokeResult<string>(bindings, COMMANDS.logsExport),
		setQuitHandlerReady: async () => {
			const result = await invokeResult(bindings, COMMANDS.setQuitHandlerReady);
			if (!result.ok) throw result.error;
		},
	};
}

/**
 * Data passed to `log_write` must survive Tauri's serialiser. A value that cannot be turned
 * into JSON is replaced by a marker, so `writeLog` never throws.
 */
function serialisableLogData(data: unknown): unknown {
	if (data === undefined) return undefined;
	try {
		return JSON.parse(JSON.stringify(data)) as unknown;
	} catch {
		return "[unserialisable]";
	}
}

/** The log sink for Rust calls that happen inside the UI, such as the slow SQLite statement log. */
export function createAppLogSink(app: Pick<AppInfo, "writeLog">) {
	return (level: "warn", message: string, data: unknown) => app.writeLog(level, message, data);
}

export type TauriDatabaseOptions = QueuedDatabaseOptions;

const DATABASE_URL = "sqlite:conducted.db";

/**
 * tauri-plugin-sql: `Database.load("sqlite:conducted.db")`, then the pragmas named in the header,
 * then the statement queue from `queued-database.ts`, which the test database runs too.
 */
export async function createTauriDatabase(
	bindings: Pick<TauriBindings, "sql"> = realTauriBindings,
	options: TauriDatabaseOptions = {},
): Promise<Result<Database>> {
	const plugin = bindings.sql;
	if (plugin === undefined) {
		return err(
			appError(
				"tauri_binding_missing",
				"The Tauri SQL plugin binding is required to open the database.",
			),
		);
	}

	let raw: SqlDatabase;
	try {
		raw = await plugin.load(DATABASE_URL);
	} catch (error) {
		return err(toAppError(error));
	}

	try {
		for (const pragma of DATABASE_PRAGMAS) await raw.execute(pragma);
	} catch (error) {
		return err(toAppError(error));
	}
	return ok(createQueuedDatabase(raw, options));
}

/**
 * The same database, opened on its first statement instead of now. Startup asks the Rust shell
 * whether the database is newer before any service touches it, so the plugin's migrator must not
 * run while the Platform is built. A failed load reaches each call waiting on it as its `AppError`,
 * and is then forgotten, so the next statement (after the startup screen's Retry) loads again.
 */
export function createLazyTauriDatabase(
	bindings: Pick<TauriBindings, "sql"> = realTauriBindings,
	options: TauriDatabaseOptions = {},
): Database {
	let opened: Promise<Result<Database>> | null = null;
	const open = (): Promise<Result<Database>> => {
		if (opened !== null) return opened;
		const attempt = createTauriDatabase(bindings, options).then((result) => {
			// A failed load must not stay cached, or a file locked at startup fails every statement.
			if (!result.ok && opened === attempt) opened = null;
			return result;
		});
		opened = attempt;
		return attempt;
	};
	const handle = async (): Promise<Database> => {
		const result = await open();
		if (!result.ok) throw result.error;
		return result.value;
	};
	return {
		execute: async (sql, params) => (await handle()).execute(sql, params),
		select: async <Row>(sql: string, params?: readonly unknown[]) =>
			(await handle()).select<Row>(sql, params),
		transaction: async <T>(work: (db: Database) => Promise<T>) =>
			(await handle()).transaction(work),
	};
}

/** Payload of `shell://done`, as shell.rs sends it. */
interface ShellDonePayload {
	id: string;
	output: ShellOutput | null;
	error: { code: string; message: string } | null;
}

/** `shell_run { command }`, `shell_start { id, command }` + `shell_cancel { id }` + event `shell://done`, `shell_login_env`. */
export function createTauriShell(bindings: TauriBindings): Shell {
	const pending = new Map<string, (result: Result<ShellOutput>) => void>();
	let listening: Promise<void> | null = null;

	const listen = (): Promise<void> => {
		listening ??= bindings
			.listen<ShellDonePayload>(EVENTS.shellDone, (payload) => {
				const resolve = pending.get(payload.id);
				if (!resolve) return;
				pending.delete(payload.id);
				if (payload.error) {
					resolve(err(appError(payload.error.code, payload.error.message)));
					return;
				}
				if (!payload.output) {
					resolve(
						err(
							appError(
								"shell_done_incomplete",
								"The shell command ended without an output or an error.",
							),
						),
					);
					return;
				}
				resolve(ok(payload.output));
			})
			.then(
				() => undefined,
				(error: unknown) => {
					// A failed listen must not stay cached, or every later start fails the same way.
					listening = null;
					throw error;
				},
			);
		return listening;
	};

	return {
		run: (command) => invokeResult<ShellOutput>(bindings, COMMANDS.shellRun, { command }),
		start: (command) => {
			const id = crypto.randomUUID();
			// Rust ignores a cancel for an id it has not registered yet, so a cancel waits for the
			// start call to be answered.
			let markStartAnswered: () => void = () => {};
			const startAnswered = new Promise<void>((resolve) => {
				markStartAnswered = resolve;
			});
			const done = (async (): Promise<Result<ShellOutput>> => {
				try {
					try {
						await listen();
					} catch (error) {
						return err(toAppError(error));
					}
					const answer = new Promise<Result<ShellOutput>>((resolve) => {
						pending.set(id, resolve);
					});
					const started = await invokeResult<void>(bindings, COMMANDS.shellStart, {
						id,
						command,
					});
					if (!started.ok) {
						pending.delete(id);
						return started;
					}
					return answer;
				} finally {
					markStartAnswered();
				}
			})();
			return {
				id,
				done,
				cancel: async () => {
					await startAnswered;
					await invokeResult(bindings, COMMANDS.shellCancel, { id });
				},
			};
		},
		loginEnv: async () => {
			const result = await invokeResult<{ shell: string; path: string }>(
				bindings,
				COMMANDS.shellLoginEnv,
			);
			if (!result.ok) throw result.error;
			return result.value;
		},
	};
}

/** `fs_read_text { path }`, `fs_write_text_atomic { path, text }`, `fs_stat { path }`, `fs_mkdirp`, `fs_read_dir`, `fs_trash`, `fs_paths`. */
export function createTauriFileSystem(
	bindings: TauriBindings,
	paths: FileSystem["paths"],
): FileSystem {
	return {
		readText: (path) => invokeResult<string>(bindings, COMMANDS.fsReadText, { path }),
		writeTextAtomic: (path, text) =>
			invokeResult<void>(bindings, COMMANDS.fsWriteTextAtomic, { path, text }),
		exists: async (path) => {
			const result = await invokeResult<FileStat | null>(bindings, COMMANDS.fsStat, { path });
			return result.ok && result.value !== null;
		},
		stat: async (path) => {
			const result = await invokeResult<FileStat | null>(bindings, COMMANDS.fsStat, { path });
			if (!result.ok) return result;
			if (result.value === null) {
				return err(appError("fs_not_found", `${path} does not exist.`));
			}
			return ok(result.value);
		},
		mkdirp: (path) => invokeResult<void>(bindings, COMMANDS.fsMkdirp, { path }),
		readDir: (path) => invokeResult<FileStat[]>(bindings, COMMANDS.fsReadDir, { path }),
		trash: (path) => invokeResult<void>(bindings, COMMANDS.fsTrash, { path }),
		paths,
	};
}

/** `search_list_tree { root }`, `search_fuzzy { root, query, limit }`, `search_grep { root, query, options }`, `search_list_artifacts { workspacePath, cursor, limit }`. */
export function createTauriFileSearch(bindings: TauriBindings): FileSearch {
	return {
		listTree: (root) => invokeResult<TreeEntry[]>(bindings, COMMANDS.searchListTree, { root }),
		listArtifacts: (workspacePath, options) =>
			invokeResult<ArtifactPage>(bindings, COMMANDS.searchListArtifacts, {
				workspacePath,
				cursor: options.cursor,
				limit: options.limit,
			}),
		fuzzyMatch: (root, query, limit) =>
			invokeResult<TreeEntry[]>(bindings, COMMANDS.searchFuzzy, { root, query, limit }),
		grep: (root, query, options) =>
			invokeResult<GrepMatch[]>(bindings, COMMANDS.searchGrep, { root, query, options }),
	};
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/** `pty_spawn { request, onOutput: Channel }`, `pty_write { id, data }`, `pty_resize`, `pty_kill`, `pty_ack { id, bytes }`, `pty_screen_text { id, maxLines }`, `pty_screen_snapshot { id }`, `pty_load_history { terminalId }`, event `pty://exit`. */
export function createTauriPty(bindings: TauriBindings): Pty {
	return {
		spawn: async (options: PtySpawn) => {
			const dataListeners = new Set<(chunk: Uint8Array) => void>();
			const exitListeners = new Set<(exitCode: number | null) => void>();
			const early: Uint8Array[] = [];
			let resolved = false;
			let exitCode: number | null | undefined;
			let handleId: string | null = null;
			// Exits seen before the spawn answer named the id. A short-lived command can end first.
			const earlyExits = new Map<string, number | null>();
			let stopExitListener: (() => void) | null = null;

			const finishExit = (code: number | null): void => {
				if (exitCode !== undefined) return;
				exitCode = code;
				for (const listener of [...exitListeners]) listener(code);
				exitListeners.clear();
				stopExitListener?.();
				stopExitListener = null;
			};

			const flushEarly = (): void => {
				if (!resolved) return;
				for (const chunk of early.splice(0)) {
					for (const listener of [...dataListeners]) listener(chunk);
				}
			};

			const channel = new Channel<{ data: string; byteLength: number }>((message) => {
				const chunk = decodeBase64(message.data);
				if (!resolved || dataListeners.size === 0) {
					early.push(chunk);
					return;
				}
				for (const listener of [...dataListeners]) listener(chunk);
			});

			// Listen before the spawn, so an exit that arrives before the answer is not lost.
			let stopListening: UnlistenFn;
			try {
				stopListening = await bindings.listen<{ id: string; exitCode: number | null }>(
					EVENTS.ptyExit,
					(payload) => {
						if (handleId === null) {
							earlyExits.set(payload.id, payload.exitCode);
						} else if (payload.id === handleId) {
							finishExit(payload.exitCode);
						}
					},
				);
			} catch (error) {
				return err(toAppError(error));
			}
			stopExitListener = stopListening;

			const spawned = await invokeResult<{ id: string; pid: number | null }>(
				bindings,
				COMMANDS.ptySpawn,
				{ request: options, onOutput: channel },
			);
			if (!spawned.ok) {
				stopListening();
				stopExitListener = null;
				return spawned;
			}

			const spawnedId = spawned.value.id;
			handleId = spawnedId;
			resolved = true;
			const exitedEarly = earlyExits.has(spawnedId);
			const earlyCode = earlyExits.get(spawnedId) ?? null;
			earlyExits.clear();
			if (exitedEarly) finishExit(earlyCode);

			const handle: PtyHandle = {
				id: spawnedId,
				write: async (data) => {
					const result = await invokeResult<void>(bindings, COMMANDS.ptyWrite, {
						id: spawnedId,
						data,
					});
					if (!result.ok) throw result.error;
				},
				resize: async (cols, rows) => {
					const result = await invokeResult<void>(bindings, COMMANDS.ptyResize, {
						id: spawnedId,
						cols,
						rows,
					});
					if (!result.ok) throw result.error;
				},
				kill: async () => {
					const result = await invokeResult<void>(bindings, COMMANDS.ptyKill, {
						id: spawnedId,
					});
					if (!result.ok) throw result.error;
				},
				onData: (listener) => {
					dataListeners.add(listener);
					flushEarly();
					return () => {
						dataListeners.delete(listener);
					};
				},
				ack: (bytes) => {
					void invokeResult<void>(bindings, COMMANDS.ptyAck, { id: spawnedId, bytes });
				},
				onExit: (listener) => {
					if (exitCode !== undefined) {
						const code = exitCode;
						queueMicrotask(() => listener(code));
						return () => {};
					}
					exitListeners.add(listener);
					return () => {
						exitListeners.delete(listener);
					};
				},
				screenText: async (maxLines) => {
					const result = await invokeResult<string>(bindings, COMMANDS.ptyScreenText, {
						id: spawnedId,
						maxLines,
					});
					if (!result.ok) throw result.error;
					return result.value;
				},
				screenSnapshot: () =>
					invokeResult<ScreenSnapshot>(bindings, COMMANDS.ptyScreenSnapshot, { id: spawnedId }),
			};
			return ok(handle);
		},
		loadHistory: () => notImplemented("PLAT-08"),
	};
}

/** `sidecar_ensure_started`, `sidecar_send { line }`, `sidecar_log_path`, events `sidecar://line` and `sidecar://restart`. */
export function createTauriSidecar(bindings: TauriBindings): SidecarTransport {
	return {
		ensureStarted: () => invokeResult<void>(bindings, COMMANDS.sidecarEnsureStarted),
		send: (line) => invokeResult<void>(bindings, COMMANDS.sidecarSend, { line }),
		onLine: (listener) => onEvent<string>(bindings, EVENTS.sidecarLine, listener),
		onRestart: (listener) => onEvent<unknown>(bindings, EVENTS.sidecarRestart, () => listener()),
		logPath: async () => {
			const result = await invokeResult<string>(bindings, COMMANDS.sidecarLogPath);
			if (!result.ok) throw result.error;
			return result.value;
		},
	};
}

/** `keychain_get { key }`, `keychain_set { key, value }`, `keychain_delete { key }`. */
export function createTauriKeychain(bindings: TauriBindings): Keychain {
	return {
		get: (key) => invokeResult<string | null>(bindings, COMMANDS.keychainGet, { key }),
		set: (key, value) => invokeResult<void>(bindings, COMMANDS.keychainSet, { key, value }),
		delete: (key) => invokeResult<void>(bindings, COMMANDS.keychainDelete, { key }),
	};
}

/**
 * `notify { request: { title, body, deepLink } }` (the Rust command checks the notification
 * permission and plays the system sound), `set_dock_badge { count }`,
 * `notification_take_pending`. The `notification://clicked` event wakes the UI, which then drains
 * the newest queued click so one that arrived before the listener is not lost. An older queued
 * click is dropped by the Rust command.
 */
export function createTauriNotifications(bindings: TauriBindings): Notifications {
	const takePending = async (): Promise<string[] | null> => {
		const result = await invokeResult<string[]>(bindings, COMMANDS.notificationTakePending);
		if (result.ok) return result.value;
		console.error(`Could not read pending notification clicks: ${result.error.message}`);
		return null;
	};

	const drain = async (
		listener: (deepLink: string) => void,
		active: () => boolean,
	): Promise<void> => {
		if (!active()) return;
		const links = await takePending();
		if (links === null || !active()) return;
		for (const link of links) {
			if (link.length > 0) listener(link);
		}
	};

	return {
		notify: async (input) => {
			const result = await invokeResult<void>(bindings, COMMANDS.notify, {
				request: { title: input.title, body: input.body, deepLink: input.deepLink },
			});
			if (!result.ok) throw result.error;
		},
		setDockBadge: async (count) => {
			const result = await invokeResult<void>(bindings, COMMANDS.setDockBadge, { count });
			if (!result.ok) throw result.error;
		},
		onClicked: (listener) => {
			let active = true;
			const unsubscribe = onEvent(bindings, EVENTS.notificationClicked, () => {
				void drain(listener, () => active);
			});
			void drain(listener, () => active);
			return () => {
				active = false;
				unsubscribe();
			};
		},
	};
}

/** plugin-dialog: `open({ directory: true })`, `open({ multiple })`, `save`, `ask`. */
export function createTauriDialogs(bindings: TauriBindings = realTauriBindings): Dialogs {
	return {
		pickFolder: async (options) => {
			const selected = await requireBinding(bindings.dialog, "dialog").open({
				title: options.title,
				defaultPath: options.defaultPath,
				directory: true,
				multiple: false,
			});
			return typeof selected === "string" ? selected : null;
		},
		pickFiles: async (options) => {
			const selected = await requireBinding(bindings.dialog, "dialog").open({
				title: options.title,
				directory: false,
				multiple: options.multiple,
			});
			if (Array.isArray(selected)) return selected;
			return typeof selected === "string" ? [selected] : [];
		},
		pickSavePath: (options) => requireBinding(bindings.dialog, "dialog").save(options),
		confirm: (options) =>
			requireBinding(bindings.dialog, "dialog").ask(options.message, {
				title: options.title,
				okLabel: options.okLabel,
			}),
	};
}

/** plugin-opener: `openUrl`; `reveal_in_finder { path }`, `open_with { appName, path }`, `installed_apps`. */
export function createTauriOpener(bindings: TauriBindings = realTauriBindings): Opener {
	return {
		openUrl: (url) => requireBinding(bindings.opener, "opener").openUrl(url),
		revealInFinder: async (path) => {
			const result = await invokeResult<void>(bindings, COMMANDS.revealInFinder, { path });
			if (!result.ok) throw result.error;
		},
		openWith: (appName, path) => invokeResult<void>(bindings, COMMANDS.openWith, { appName, path }),
		installedApps: async () => {
			const result = await invokeResult<string[]>(bindings, COMMANDS.installedApps);
			if (!result.ok) throw result.error;
			return result.value;
		},
	};
}

/** plugin-clipboard-manager: `writeText`, `writeImage`. */
export function createTauriClipboard(bindings: TauriBindings = realTauriBindings): Clipboard {
	return {
		writeText: (text) => requireBinding(bindings.clipboard, "clipboard").writeText(text),
		writeImage: (pngBytes) => requireBinding(bindings.clipboard, "clipboard").writeImage(pngBytes),
	};
}

/** `speech_available`, `speech_start { onEvent: Channel }`, `speech_stop`, `speech_cancel`. */
export function createTauriSpeech(bindings: TauriBindings): Speech {
	return {
		available: async () => {
			const result = await invokeResult<boolean>(bindings, COMMANDS.speechAvailable);
			// The interface has no failure channel. A failed check hides the button, as the
			// platform layer does for `fs.exists`.
			return result.ok && result.value;
		},
		start: (onEvent) => {
			const channel = new Channel<SpeechEvent>((event) => onEvent(event));
			return invokeResult<void>(bindings, COMMANDS.speechStart, { onEvent: channel });
		},
		stop: async () => {
			const result = await invokeResult<void>(bindings, COMMANDS.speechStop);
			if (!result.ok) throw result.error;
		},
		cancel: async () => {
			const result = await invokeResult<void>(bindings, COMMANDS.speechCancel);
			if (!result.ok) throw result.error;
		},
	};
}

/** `updater_check`, `updater_install`, `updater_relaunch`, `updater_installed_update`, event `updater://status`. */
export function createTauriUpdater(_bindings: TauriBindings): Updater {
	return {
		check: () => notImplemented("PLAT-13"),
		install: () => notImplemented("PLAT-13"),
		relaunch: () => notImplemented("PLAT-13"),
		installedUpdate: () => notImplemented("PLAT-13"),
	};
}

/**
 * Window API: `isFocused`, `onFocusChanged` (`tauri://focus`, `tauri://blur`), `setTheme`.
 * Webview API: `onDragDropEvent`, `setZoom`. Commands: `window_set_vibrancy { enabled }`,
 * `window_set_traffic_lights { x, y }`, `window_toggle_inspector`.
 */
export function createTauriWindow(bindings: TauriBindings): AppWindow {
	const currentWindow = (): TauriWindowBindings => requireBinding(bindings.window, "window");
	return {
		isFocused: () => currentWindow().isFocused(),
		onFocusChanged: (listener) => {
			const window = currentWindow();
			const stopFocus = onEvent(window, EVENTS.windowFocus, () => listener(true));
			const stopBlur = onEvent(window, EVENTS.windowBlur, () => listener(false));
			return () => {
				stopFocus();
				stopBlur();
			};
		},
		onFileDrop: (listener) => {
			const window = currentWindow();
			return subscribe<TauriDragDropEvent>(
				(handler) => window.onDragDropEvent(handler),
				(event) => listener(toFileDropEvent(event)),
			);
		},
		setZoom: () => notImplemented("PLAT-23"),
		setVibrancy: () => notImplemented("PLAT-23"),
		setTrafficLightPosition: () => notImplemented("PLAT-23"),
		setTheme: () => notImplemented("PLAT-23"),
		toggleInspector: async () => {
			const result = await invokeResult(bindings, COMMANDS.windowToggleInspector);
			if (!result.ok) throw result.error;
		},
	};
}

/** `menu_set_shortcuts { shortcuts }`, event `menu://command` (payload: command id). */
export function createTauriMenu(bindings: TauriBindings): AppMenu {
	return {
		setShortcuts: (shortcuts) =>
			invokeResult(bindings, COMMANDS.menuSetShortcuts, { shortcuts: [...shortcuts] }),
		onCommand: (listener) => onEvent(bindings, EVENTS.menuCommand, listener),
	};
}

/** `system_info`, `network_status`, event `network://changed`, `full_disk_access_check`, `full_disk_access_open_settings`. */
export function createTauriSystem(bindings: TauriBindings): SystemFacts {
	return {
		info: () => bindings.invoke<SystemInfo>(COMMANDS.systemInfo),
		isOnline: () => notImplemented("PLAT-26"),
		onNetworkChanged: () => notImplemented("PLAT-26"),
		hasFullDiskAccess: () => notImplemented("PLAT-24"),
		openFullDiskAccessSettings: () => notImplemented("PLAT-24"),
	};
}

/** `attachment_materialize { sourcePath, destinationPath, resizeImage }`, `image_resize { sourcePath, destinationPath }`. */
export function createTauriAttachments(bindings: TauriBindings): AttachmentFiles {
	return {
		materialize: (sourcePath, destinationPath, options) =>
			invokeResult(bindings, COMMANDS.attachmentMaterialize, {
				sourcePath,
				destinationPath,
				resizeImage: options.resizeImage,
			}),
		resizeImage: (sourcePath, destinationPath) =>
			invokeResult(bindings, COMMANDS.imageResize, { sourcePath, destinationPath }),
	};
}

/**
 * `programs_state`, `program_install { program }`, `program_redownload { program }`,
 * `program_remove { program }`, `programs_prefetch`, `programs_verification_errors`,
 * `programs_sync_path_overrides { overrides }`, events `programs://status` and
 * `programs://verification-errors`.
 */
export function createTauriPrograms(bindings: TauriBindings): Programs {
	return {
		statuses: () => invokeResult<ProgramStatus[]>(bindings, COMMANDS.programsState),
		onStatus: (listener) => onEvent(bindings, EVENTS.programsStatus, listener),
		install: (program) => invokeResult(bindings, COMMANDS.programInstall, { program }),
		redownload: (program) => invokeResult(bindings, COMMANDS.programRedownload, { program }),
		remove: (program) => invokeResult(bindings, COMMANDS.programRemove, { program }),
		prefetchForUpdate: () => invokeResult(bindings, COMMANDS.programsPrefetch),
		verificationErrors: async () => {
			const result = await invokeResult<{ program: ManagedProgram; message: string }[]>(
				bindings,
				COMMANDS.programsVerificationErrors,
			);
			if (!result.ok) throw result.error;
			return result.value;
		},
		syncPathOverrides: () => notImplemented("SET-13"),
	};
}

/** `http_fetch { request }`, `http_download { id, url, destinationPath, expectedSha256, onProgress: Channel }`, `http_cancel { id }`. */
export function createTauriHttp(bindings: TauriBindings): Http {
	return {
		fetch: (request) => invokeResult<HttpResponse>(bindings, COMMANDS.httpFetch, { request }),
		download: (input) => {
			const id = crypto.randomUUID();
			const channel = new Channel<{ receivedBytes: number; totalBytes: number | null }>(
				(message) => {
					input.onProgress?.(message.receivedBytes, message.totalBytes);
				},
			);
			const done = invokeResult<{ path: string; sizeBytes: number; sha256: string }>(
				bindings,
				COMMANDS.httpDownload,
				{
					id,
					url: input.url,
					destinationPath: input.destinationPath,
					expectedSha256: input.expectedSha256 ?? null,
					onProgress: channel,
				},
			);
			return {
				id,
				done,
				cancel: async () => {
					const result = await invokeResult(bindings, COMMANDS.httpCancel, { id });
					if (!result.ok) throw result.error;
				},
			};
		},
	};
}

interface AppInfoPayload {
	version: string;
	channel: "dev" | "release";
}

interface FsPathsPayload {
	home: string;
	appData: string;
	temp: string;
	resources: string;
}

/**
 * Builds the whole Platform. Order: health check, `app_info`, `fs_paths`, then the groups above.
 * The database opens on its first statement, so the startup version check runs before the plugin's
 * migrator. Returns the first failed startup call as an `Err`.
 */
export async function createTauriPlatform(
	bindings: TauriBindings = realTauriBindings,
): Promise<Result<Platform>> {
	const health = await checkHealth(bindings);
	if (!health.ok) return health;

	const info = await invokeResult<AppInfoPayload>(bindings, COMMANDS.appInfo);
	if (!info.ok) return info;

	const paths = await invokeResult<FsPathsPayload>(bindings, COMMANDS.fsPaths);
	if (!paths.ok) return paths;

	const app = createTauriAppInfo(bindings, info.value);

	const platform: Platform = {
		app,
		db: createLazyTauriDatabase(bindings, { log: createAppLogSink(app) }),
		shell: createTauriShell(bindings),
		fs: createTauriFileSystem(bindings, paths.value),
		fileSearch: createTauriFileSearch(bindings),
		pty: createTauriPty(bindings),
		sidecar: createTauriSidecar(bindings),
		keychain: createTauriKeychain(bindings),
		notifications: createTauriNotifications(bindings),
		dialogs: createTauriDialogs(bindings),
		opener: createTauriOpener(bindings),
		clipboard: createTauriClipboard(bindings),
		speech: createTauriSpeech(bindings),
		updater: createTauriUpdater(bindings),
		window: createTauriWindow(bindings),
		menu: createTauriMenu(bindings),
		system: createTauriSystem(bindings),
		attachments: createTauriAttachments(bindings),
		programs: createTauriPrograms(bindings),
		http: createTauriHttp(bindings),
	};
	return ok(platform);
}
