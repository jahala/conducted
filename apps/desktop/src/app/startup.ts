/**
 * @feature APP-01 Startup sequence
 * Owns: the ordered start of the app before the first screen: open the database, block when it is newer than
 * the app, load settings, start the services, reset chats left "working" to idle, start the sidecar.
 * Behaviour: services-map.md part 6 (startup is strictly ordered and gated).
 * Order (services-map 6, phase 3): settings first because every service reads them; then repos and workspaces;
 * then sections; then git, sessions and the composer; the sidecar last, so the first acknowledgement of an
 * event has somewhere to land. Sessions are reset to idle before any screen sees them.
 * Our design choice: progress is reported through a callback and the end result is a Result, so main.tsx can
 * draw a designed loading, blocked or failed screen without catching exceptions.
 * Must handle: a database written by a newer app blocks every later step and returns `blocked`; a step that
 * is allowed to fail (favourite models, sections) is logged and skipped; a second call while one runs returns
 * the same run; the sidecar failing to start is a `failed` state with the sidecar's log path.
 * Test first: with a database marked newer than the app, runStartup reports `blocked` and starts no service.
 */
import { notImplemented, type Result } from "@conducted/shared";

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

export function runStartup(_report: (state: StartupState) => void): Promise<Result<void>> {
	return notImplemented("APP-01");
}
