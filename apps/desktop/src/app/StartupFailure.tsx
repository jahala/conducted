/**
 * @feature APP-08 Start-up blocker screens
 * Owns: the full-window screens for a start that cannot go on: "Database from a newer version" with an
 * Update button, "Wrong version of Conducted for this Mac" (an Intel build on Apple silicon), and "Failed to
 * start agents" with "Copy diagnostics" and "Retry".
 * Behaviour: ui-map.md 7.4 (app-level blockers: "Database from a newer version" with Update; "Wrong version
 * of Conductor for this Mac"; "Failed to start agents / Conductor will not work. Please report this error.");
 * coverage/settings-states-kit.md (the failed state has `logPath`; offer "Copy diagnostics" and "Retry").
 * Left out on purpose: the "Database rollback" terminal (staff tool), "Update required" and "isn't available
 * in your region" (hosted service checks, D025).
 * Data: `StartupState` from app/startup.ts for the first and third screens. The CPU facts come from
 * useSystemInfo (core/hooks.ts, PLAT-32): `machineArch` arm64 with `buildArch` x86_64. Update runs
 * `Actions.app.checkForUpdates` then `installUpdate`; diagnostics copy through `Actions.app.copyText`; the
 * log opens with `Actions.app.openSidecarLogs`.
 * Product name: the screens say "Conducted" (see StartupScreen.tsx).
 * Must handle: a database newer than the app (no step after it runs, the screen explains that the data is
 * untouched, and Update is the one primary action); no update available (Update says so and stays
 * useful: "Quit" is offered); a failed start with no log path (diagnostics still copy the message); Retry
 * while a retry runs (disabled, one run only); diagnostics that contain home-folder paths (shown to the
 * user before they send them anywhere, nothing is sent by the app); the window draggable; the message in
 * plain words, never a stack trace.
 * Test first: a `blocked` state shows "Database from a newer version" and an Update button; clicking it
 * checks for updates once.
 */
import { notImplemented } from "@conducted/shared";
import type { SystemInfo } from "../core/model.ts";
import type { StartupState } from "./startup.ts";

export type StartupBlocker =
	| Extract<StartupState, { kind: "blocked" } | { kind: "failed" }>
	| { kind: "wrong_cpu_build"; system: SystemInfo };

export interface StartupFailureProps {
	blocker: StartupBlocker;
	onUpdate: () => void;
	onRetry: () => void;
	onCopyDiagnostics: () => void;
	onQuit: () => void;
}

export function StartupFailure(_props: StartupFailureProps): never {
	return notImplemented("APP-08");
}
