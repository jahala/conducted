/**
 * @feature APP-01 Startup sequence
 * Owns: the ordered start of the app before the first screen: open the database, block when it is newer than
 * the app, load settings, start the services, reset chats left "working" to idle, start the sidecar.
 * Behaviour: services-map.md part 6 (startup is strictly ordered and gated).
 * Order (services-map 6, phase 3): settings first because every service reads them; then repos and workspaces;
 * then sections; then git, sessions and the composer; the sidecar last, so the first acknowledgement of an
 * event has somewhere to land. Sessions are reset to idle before any screen sees them. The steps themselves
 * live in container.start; this file adds the database gate and the screen states around them.
 * Our design choice: progress is reported through a callback and the end result is a Result, so main.tsx can
 * draw a designed loading, blocked or failed screen without catching exceptions.
 * Must handle: a database written by a newer app blocks every later step and returns `blocked`; a step that
 * is allowed to fail (favourite models, sections) is logged and skipped; the container runs its start once and
 * returns the first result to later callers; the sidecar failing to start is a `failed` state with its log
 * path; every failed state is written to the app log once, with the whole error, so the reason of the part
 * that failed (SQLite's words, say) is on disk even though the screen shows only the message (#628).
 * Test first: with a database marked newer than the app, runStartup reports `blocked` and starts no service.
 */
import { appError, err, messageOf, ok, type Result } from "@conducted/shared";
import type { Container } from "../core/container.ts";
import type { Platform } from "../platform/platform.ts";
import { installBrowserMenuGuard } from "./browser-menu.ts";

export type StartupPhase = "database" | "settings" | "services" | "sidecar";

export type StartupState =
	| { kind: "running"; phase: StartupPhase }
	| {
			kind: "blocked";
			reason: "database_newer_than_app";
			databaseVersion: string;
			appVersion: string;
	  }
	| { kind: "failed"; phase: StartupPhase; message: string; logPath: string | null }
	| { kind: "ready" };

export interface StartupOptions {
	/** Installs the process-wide error, drag-and-drop and browser-menu handlers. On unless a test says otherwise. */
	installHandlers?: boolean;
}

/** Runs the database gate, then the container's ordered start, and reports each state. */
export async function runStartup(
	container: Container,
	report: (state: StartupState) => void,
	options: StartupOptions = {},
): Promise<Result<void>> {
	const { platform } = container;
	if (options.installHandlers !== false) installGlobalHandlers(platform);

	report({ kind: "running", phase: "database" });
	let warning: Awaited<ReturnType<Platform["app"]["dbVersionWarning"]>>;
	try {
		warning = await platform.app.dbVersionWarning();
	} catch (cause) {
		await reportFailure(platform, report, "database", cause);
		return err(appError("startup_failed", messageOf(cause), cause));
	}
	if (!warning.ok) {
		await reportFailure(platform, report, "database", warning.error);
		return err(warning.error);
	}
	if (warning.value !== null) {
		report({
			kind: "blocked",
			reason: "database_newer_than_app",
			databaseVersion: String(warning.value.databaseVersion),
			appVersion: String(warning.value.appVersion),
		});
		return ok(undefined);
	}

	let phase: StartupPhase = "settings";
	try {
		const started = await container.start((progress) => {
			phase = progress.phase;
			report({ kind: "running", phase: progress.phase });
		});
		if (!started.ok) {
			await reportFailure(platform, report, phase, started.error);
			return err(started.error);
		}
		report({ kind: "ready" });
		return ok(undefined);
	} catch (cause) {
		await reportFailure(platform, report, phase, cause);
		return err(appError("startup_failed", messageOf(cause), cause));
	}
}

/**
 * Reports a failed start and writes it to the app log once. The log gets the whole error: its
 * causes hold the words of the part that failed, such as SQLite's reason, which the screen's
 * message leaves out (issue #628). A thrown Error is written as its stack, since JSON drops it.
 */
async function reportFailure(
	platform: Platform,
	report: (state: StartupState) => void,
	phase: StartupPhase,
	error: unknown,
): Promise<void> {
	const message = messageOf(error);
	const logPath = await sidecarLogPath(platform);
	platform.app.writeLog("error", `Startup failed during ${phase}`, {
		message,
		logPath,
		error: error instanceof Error ? describeForLog(error) : error,
	});
	report({ kind: "failed", phase, message, logPath });
}

/**
 * Installs the handlers that keep unhandled errors in the local log, forwards `console.error`, stops the
 * webview from navigating to a file dropped on the window, and blocks its own browser menu (APP-01's
 * browser menu guard). Returns the function that removes them.
 */
export function installGlobalHandlers(platform: Pick<Platform, "app">): () => void {
	const log = (message: string, data: unknown): void =>
		platform.app.writeLog("error", message, data);

	const onError = (event: ErrorEvent): void => {
		log("Unhandled error", {
			message: event.message,
			stack: event.error instanceof Error ? (event.error.stack ?? null) : null,
		});
	};
	const onRejection = (event: PromiseRejectionEvent): void => {
		log("Unhandled promise rejection", { reason: describeForLog(event.reason) });
	};
	const preventNavigation = (event: Event): void => {
		event.preventDefault();
	};

	const originalConsoleError = console.error;
	console.error = (...args: unknown[]) => {
		originalConsoleError.apply(console, args);
		log("console.error", args.map(describeForLog).join(" "));
	};

	const removeBrowserMenuGuard = installBrowserMenuGuard();

	window.addEventListener("error", onError);
	window.addEventListener("unhandledrejection", onRejection);
	window.addEventListener("dragenter", preventNavigation);
	window.addEventListener("dragover", preventNavigation);
	window.addEventListener("drop", preventNavigation);

	return () => {
		removeBrowserMenuGuard();
		window.removeEventListener("error", onError);
		window.removeEventListener("unhandledrejection", onRejection);
		window.removeEventListener("dragenter", preventNavigation);
		window.removeEventListener("dragover", preventNavigation);
		window.removeEventListener("drop", preventNavigation);
		console.error = originalConsoleError;
	};
}

/** The sidecar's log file, or null when the Platform cannot say. The reason goes to the app log. */
async function sidecarLogPath(platform: Platform): Promise<string | null> {
	try {
		return await platform.sidecar.logPath();
	} catch (cause) {
		const message = messageOf(cause);
		platform.app.writeLog("warn", "The sidecar log path could not be read", { message });
		return null;
	}
}

function describeForLog(value: unknown): string {
	if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}
