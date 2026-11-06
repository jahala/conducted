/**
 * @feature APP-08 Start-up loading screen
 * Owns: the full-window screen "Starting Conducted" that shows while the ordered start-up runs, before the
 * first route.
 * Behaviour: ui-map.md 7.3 (each loading region has role="status" and an aria-label; one of them is
 * "Starting Conductor"); services-map.md part 6 (start-up is ordered and gated). `runStartup` in
 * app/startup.ts reports `StartupState` with a phase, and main.tsx draws this screen until it is ready.
 * Product name: the screens of this app say "Conducted" where the research says "Conductor" (CLAUDE.md,
 * D020 keeps the behaviour, not the name).
 * Our design choice: each phase gets a plain line in our own words. The status region has one fixed name, so a
 * screen reader hears one status message; the phase line inside it changes. The caller may delay the screen
 * for a fast start; this component renders at once.
 * Must handle: every phase getting its name; the window still draggable by its title strip
 * (data-tauri-drag-region); reduced motion (the global rule stops the turn); light and dark themes before the
 * settings are loaded (the tokens follow the system).
 * Test first: with phase "sidecar" the screen has role "status", the name "Starting Conducted", and shows
 * the sidecar phase text.
 */
import type { StartupPhase } from "./startup.ts";

export interface StartupScreenProps {
	phase: StartupPhase;
}

const PHASE_TEXT: Record<StartupPhase, string> = {
	database: "Opening the database",
	settings: "Loading settings",
	services: "Starting services",
	sidecar: "Starting agents",
};

export function StartupScreen({ phase }: StartupScreenProps) {
	return (
		<div data-tauri-drag-region className="flex h-full w-full flex-col bg-canvas">
			<div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
			<div
				role="status"
				aria-label="Starting Conducted"
				className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-10 text-center"
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					className="size-6 animate-spin text-fg-subtle"
					aria-hidden="true"
				>
					<circle
						cx="12"
						cy="12"
						r="9"
						stroke="currentColor"
						strokeOpacity="0.25"
						strokeWidth="3"
					/>
					<path
						d="M21 12a9 9 0 0 0-9-9"
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
					/>
				</svg>
				<p className="text-xl font-medium text-fg">Starting Conducted</p>
				<p className="text-sm text-fg-muted">{PHASE_TEXT[phase]}</p>
			</div>
		</div>
	);
}
