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
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Image } from "@tauri-apps/api/image";
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
	AttachmentFiles,
	Clipboard,
	Database,
	Dialogs,
	FileSearch,
	FileStat,
	FileSystem,
	Http,
	Keychain,
	Notifications,
	Opener,
	Platform,
	Programs,
	Pty,
	PtyHandle,
	PtySpawn,
	ScreenSnapshot,
	Shell,
	ShellOutput,
	SidecarTransport,
	Speech,
	SystemFacts,
	Updater,
} from "./platform.ts";

// ---------------------------------------------------------------- bindings

/** The database handle tauri-plugin-sql returns. Only the calls the Platform needs. */
export interface SqlDatabase {
	execute(
		query: string,
		bindValues?: unknown[],
	): Promise<{ rowsAffected: number; lastInsertId?: number }>;
	select<Rows>(query: string, bindValues?: unknown[]): Promise<Rows>;
}

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

export interface TauriBindings {
	invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
	listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>;
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
function onEvent<T>(
	bindings: Pick<TauriBindings, "listen">,
	event: string,
	handler: (payload: T) => void,
): () => void {
	let active = true;
	let unlisten: UnlistenFn | null = null;
	void bindings
		.listen<T>(event, (payload) => {
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

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ---------------------------------------------------------------- names (docs/plans/tauri-commands.md)

/** Command names registered by the Rust shell. Both sides use exactly these. */
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
	networkStatus: "network_status",
	fullDiskAccessCheck: "full_disk_access_check",
	fullDiskAccessOpenSettings: "full_disk_access_open_settings",
	windowSetVibrancy: "window_set_vibrancy",
	windowSetTrafficLights: "window_set_traffic_lights",
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
	searchListArtifacts: "search_list_artifacts",
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
	updaterInstalledUpdate: "updater_installed_update",
	attachmentMaterialize: "attachment_materialize",
	imageResize: "image_resize",
	menuSetShortcuts: "menu_set_shortcuts",
	programsState: "programs_state",
	programInstall: "program_install",
	programRedownload: "program_redownload",
	programRemove: "program_remove",
	programsPrefetch: "programs_prefetch",
	programsVerificationErrors: "programs_verification_errors",
	programsSyncPathOverrides: "programs_sync_path_overrides",
	httpFetch: "http_fetch",
	httpDownload: "http_download",
	httpCancel: "http_cancel",
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

/** `app_info` -> `{ version, channel }`; `app_quit`; `resource_usage`; `log_write`; `log_set_level { level }`; `logs_export`; `set_quit_handler_ready`. Events: quit, deep link. */
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
		onQuitRequested: (listener) => onEvent(bindings, EVENTS.quitRequested, () => listener()),
		quit: async () => {
			await invokeResult(bindings, COMMANDS.appQuit);
		},
		resourceUsage: () => notImplemented("PLAT-14"),
		writeLog: () => notImplemented("PLAT-18"),
		setLogLevel: () => notImplemented("PLAT-18"),
		exportLogs: () => notImplemented("PLAT-18"),
		setQuitHandlerReady: () => notImplemented("PLAT-15"),
	};
}

export interface TauriDatabaseOptions {
	/** A statement at or above this many milliseconds is logged. Defaults to 1000. */
	slowMs?: number;
	/** Where slow statements go. The Platform passes `app.writeLog`. */
	log?: (level: "warn", message: string, data: unknown) => void;
}

const DATABASE_URL = "sqlite:conducted.db";

/**
 * tauri-plugin-sql: `Database.load("sqlite:conducted.db")`, then the pragmas named in the header.
 * `select` and `execute` map to the plugin's methods; `transaction` sends BEGIN IMMEDIATE and
 * COMMIT or ROLLBACK on one connection, queued behind any open transaction. Identical concurrent
 * `select` calls share one promise, and a statement slower than `slowMs` goes to the log.
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

	const slowMs = options.slowMs ?? 1_000;
	const log = options.log ?? (() => {});
	const logIfSlow = (sql: string, startedAt: number): void => {
		const elapsedMs = nowMs() - startedAt;
		if (elapsedMs >= slowMs) {
			log("warn", "Slow SQLite call", { sql, elapsedMs });
		}
	};
	const write = async (
		sql: string,
		params?: readonly unknown[],
	): Promise<{ rowsAffected: number; lastInsertId?: number }> => {
		const startedAt = nowMs();
		try {
			return await raw.execute(sql, params === undefined ? undefined : [...params]);
		} finally {
			logIfSlow(sql, startedAt);
		}
	};
	const read = async <Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> => {
		const startedAt = nowMs();
		try {
			return (await raw.select<Row[]>(
				sql,
				params === undefined ? undefined : [...params],
			)) as Row[];
		} finally {
			logIfSlow(sql, startedAt);
		}
	};

	try {
		await write("PRAGMA journal_mode = WAL");
		await write("PRAGMA foreign_keys = ON");
	} catch (error) {
		return err(toAppError(error));
	}

	const pendingSelects = new Map<string, Promise<unknown[]>>();
	let inTransaction = false;
	let transactionQueue: Promise<unknown> = Promise.resolve();

	const database: Database = {
		execute: write,
		select: <Row>(sql: string, params?: readonly unknown[]): Promise<Row[]> => {
			if (inTransaction) return read<Row>(sql, params);
			const key = `${sql}\u0000${JSON.stringify(params ?? [])}`;
			const existing = pendingSelects.get(key);
			if (existing !== undefined) return existing as Promise<Row[]>;
			const promise = read<Row>(sql, params);
			pendingSelects.set(key, promise as Promise<unknown[]>);
			const settle = (): void => {
				pendingSelects.delete(key);
			};
			void promise.then(settle, settle);
			return promise;
		},
		transaction: <T>(work: (db: Database) => Promise<T>): Promise<T> => {
			const run = transactionQueue.then(async () => {
				await write("BEGIN IMMEDIATE");
				inTransaction = true;
				try {
					const value = await work(database);
					await write("COMMIT");
					return value;
				} catch (error) {
					try {
						await write("ROLLBACK");
					} catch {
						// The failure that caused the rollback is the one the caller needs.
					}
					throw error;
				} finally {
					inTransaction = false;
				}
			});
			transactionQueue = run.then(
				() => undefined,
				() => undefined,
			);
			return run;
		},
	};
	return ok(database);
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
			.then(() => undefined);
		return listening;
	};

	return {
		run: (command) => invokeResult<ShellOutput>(bindings, COMMANDS.shellRun, { command }),
		start: (command) => {
			const id = crypto.randomUUID();
			const done = (async (): Promise<Result<ShellOutput>> => {
				try {
					await listen();
				} catch (error) {
					return err(toAppError(error));
				}
				const answer = new Promise<Result<ShellOutput>>((resolve) => {
					pending.set(id, resolve);
				});
				const started = await invokeResult<void>(bindings, COMMANDS.shellStart, { id, command });
				if (!started.ok) {
					pending.delete(id);
					return started;
				}
				return answer;
			})();
			return {
				id,
				done,
				cancel: async () => {
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
export function createTauriFileSearch(_bindings: TauriBindings): FileSearch {
	return {
		listTree: () => notImplemented("PLAT-06"),
		listArtifacts: () => notImplemented("REV-10"),
		fuzzyMatch: () => notImplemented("PLAT-06"),
		grep: () => notImplemented("PLAT-06"),
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
			let unlisten: UnlistenFn | null = null;

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

			const spawned = await invokeResult<{ id: string; pid: number | null }>(
				bindings,
				COMMANDS.ptySpawn,
				{ request: options, onOutput: channel },
			);
			if (!spawned.ok) return spawned;

			const handleId = spawned.value.id;
			resolved = true;
			unlisten = await bindings.listen<{ id: string; exitCode: number | null }>(
				EVENTS.ptyExit,
				(payload) => {
					if (payload.id !== handleId) return;
					const code = payload.exitCode;
					exitCode = code;
					for (const listener of [...exitListeners]) listener(code);
					exitListeners.clear();
					if (unlisten !== null) {
						unlisten();
						unlisten = null;
					}
				},
			);

			const handle: PtyHandle = {
				id: handleId,
				write: async (data) => {
					const result = await invokeResult<void>(bindings, COMMANDS.ptyWrite, {
						id: handleId,
						data,
					});
					if (!result.ok) throw result.error;
				},
				resize: async (cols, rows) => {
					const result = await invokeResult<void>(bindings, COMMANDS.ptyResize, {
						id: handleId,
						cols,
						rows,
					});
					if (!result.ok) throw result.error;
				},
				kill: async () => {
					const result = await invokeResult<void>(bindings, COMMANDS.ptyKill, {
						id: handleId,
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
					void invokeResult<void>(bindings, COMMANDS.ptyAck, { id: handleId, bytes });
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
						id: handleId,
						maxLines,
					});
					if (!result.ok) throw result.error;
					return result.value;
				},
				screenSnapshot: () =>
					invokeResult<ScreenSnapshot>(bindings, COMMANDS.ptyScreenSnapshot, { id: handleId }),
			};
			return ok(handle);
		},
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
		revealInFinder: () => notImplemented("PLAT-19"),
		openWith: () => notImplemented("PLAT-19"),
		installedApps: () => notImplemented("PLAT-19"),
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
export function createTauriSpeech(_bindings: TauriBindings): Speech {
	return {
		available: () => notImplemented("PLAT-12"),
		start: () => notImplemented("PLAT-12"),
		stop: () => notImplemented("PLAT-12"),
		cancel: () => notImplemented("PLAT-12"),
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
export function createTauriWindow(_bindings: TauriBindings): AppWindow {
	return {
		isFocused: () => notImplemented("PLAT-31"),
		onFocusChanged: () => notImplemented("PLAT-31"),
		onFileDrop: () => notImplemented("PLAT-33"),
		setZoom: () => notImplemented("PLAT-23"),
		setVibrancy: () => notImplemented("PLAT-23"),
		setTrafficLightPosition: () => notImplemented("PLAT-23"),
		setTheme: () => notImplemented("PLAT-23"),
		toggleInspector: () => notImplemented("PLAT-15"),
	};
}

/** `menu_set_shortcuts { shortcuts }`, event `menu://command` (payload: command id). */
export function createTauriMenu(_bindings: TauriBindings): AppMenu {
	return {
		setShortcuts: () => notImplemented("PLAT-33"),
		onCommand: () => notImplemented("PLAT-33"),
	};
}

/** `system_info`, `network_status`, event `network://changed`, `full_disk_access_check`, `full_disk_access_open_settings`. */
export function createTauriSystem(_bindings: TauriBindings): SystemFacts {
	return {
		info: () => notImplemented("PLAT-32"),
		isOnline: () => notImplemented("PLAT-26"),
		onNetworkChanged: () => notImplemented("PLAT-26"),
		hasFullDiskAccess: () => notImplemented("PLAT-24"),
		openFullDiskAccessSettings: () => notImplemented("PLAT-24"),
	};
}

/** `attachment_materialize { sourcePath, destinationPath, resizeImage }`, `image_resize { sourcePath, destinationPath }`. */
export function createTauriAttachments(_bindings: TauriBindings): AttachmentFiles {
	return {
		materialize: () => notImplemented("PLAT-33"),
		resizeImage: () => notImplemented("PLAT-33"),
	};
}

/**
 * `programs_state`, `program_install { program }`, `program_redownload { program }`,
 * `program_remove { program }`, `programs_prefetch`, `programs_verification_errors`,
 * `programs_sync_path_overrides { overrides }`, events `programs://status` and
 * `programs://verification-errors`.
 */
export function createTauriPrograms(_bindings: TauriBindings): Programs {
	return {
		statuses: () => notImplemented("PLAT-28"),
		onStatus: () => notImplemented("PLAT-28"),
		install: () => notImplemented("PLAT-28"),
		redownload: () => notImplemented("PLAT-28"),
		remove: () => notImplemented("PLAT-28"),
		prefetchForUpdate: () => notImplemented("PLAT-28"),
		verificationErrors: () => notImplemented("PLAT-34"),
		syncPathOverrides: () => notImplemented("SET-13"),
	};
}

/** `http_fetch { request }`, `http_download { url, destinationPath, expectedSha256, onProgress: Channel }`, `http_cancel { id }`. */
export function createTauriHttp(_bindings: TauriBindings): Http {
	return {
		fetch: () => notImplemented("PLAT-30"),
		download: () => notImplemented("PLAT-30"),
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
 * Builds the whole Platform. Order: health check, `app_info`, `fs_paths`, database load, then
 * the groups above. Returns the first failure as an `Err`.
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
	const database = await createTauriDatabase(bindings, {
		log: (level, message, data) => {
			try {
				app.writeLog(level, message, data);
			} catch {
				// Logging a slow statement must never turn a working query into a failure.
			}
		},
	});
	if (!database.ok) return database;

	const platform: Platform = {
		app,
		db: database.value,
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
