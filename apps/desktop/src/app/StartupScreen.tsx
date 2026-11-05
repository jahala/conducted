/**
 * @feature APP-08 Start-up loading screen
 * Owns: the full-window screen "Starting Conducted" that shows while the ordered start-up runs, before the
 * first route.
 * Behaviour: ui-map.md 7.3 (each loading region has role="status" and an aria-label; one of them is
 * "Starting Conductor"); services-map.md part 6 (start-up is ordered and gated). `runStartup` in
 * app/startup.ts reports `StartupState` with a phase; nothing draws it yet.
 * Product name: the screens of this app say "Conducted" where the research says "Conductor" (CLAUDE.md,
 * D020 keeps the behaviour, not the name).
 * Must handle: a fast start (no flash: the screen appears only after a short delay, and once shown stays
 * long enough to read); a slow phase (a plain line names the phase: database, settings, services,
 * sidecar); the window still draggable by its title strip (data-tauri-drag-region); a screen reader
 * hearing one status message and not each phase change as a new announcement; reduced motion (no spinner
 * animation beyond a static mark); light and dark theme before settings are loaded (follows the system).
 * Test first: with phase "sidecar" the screen has role "status", the name "Starting Conducted", and shows
 * the sidecar phase text.
 */
import { notImplemented } from "@conducted/shared";
import type { StartupPhase } from "./startup.ts";

export interface StartupScreenProps {
	phase: StartupPhase;
}

export function StartupScreen(_props: StartupScreenProps): never {
	return notImplemented("APP-08");
}
