/**
 * @feature RUN-06 Terminal tabs
 * Owns: the one rule a new terminal checks first: the user's terminal settings are loaded.
 * Behaviour: Conductor's terminal-settings query (renderApp @10085340): while it loads a new
 * terminal says "Terminal settings are still loading."; when it failed, "Failed to load terminal
 * settings.". A terminal would otherwise start with the defaults and drop the user's choice.
 * Must handle: a settings store that has not loaded, one whose load failed, and one that is ready.
 * Test first: a store that has not loaded answers "loading".
 */
export type TerminalSettingsProblem = "loading" | "failed";

/** What stops a new terminal from starting, or null when the terminal settings are ready. */
export function terminalSettingsProblem(state: {
	loaded: boolean;
	warnings: readonly { code: string }[];
}): TerminalSettingsProblem | null {
	if (!state.loaded) return "loading";
	if (state.warnings.some((warning) => warning.code === "settings_load_failed")) return "failed";
	return null;
}

/** Conductor's warning for each problem, in the order the terminal panel raises it. */
export const TERMINAL_SETTINGS_MESSAGES: Readonly<Record<TerminalSettingsProblem, string>> = {
	loading: "Terminal settings are still loading.",
	failed: "Failed to load terminal settings.",
};
