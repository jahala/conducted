/**
 * @feature RUN-06 Big terminal mode
 * Owns: the preset commands a new big terminal can start with, and the pure mapping from the
 * stored preset (or one of the user's own commands) to the command a terminal starts with.
 * Behaviour: ui-map.md 6, "Big terminal" (the New tab preset list; Conductor's commands per agent,
 * renderApp @10675300 and the command table at @437950 in main; the experimental setting
 * `big_terminal_preset` stores the chosen preset).
 * Our design choice: Conductor picks its flags by whether tool approvals are on; ours reads the
 * same `tool_approvals_enabled` setting.
 * Must handle: no preset (None), a custom command chosen by its index, a chosen custom command
 * whose line was removed (no command), and tool approvals on or off.
 * Test first: the Gemini preset gives "gemini -y".
 */

export interface BigTerminalPreset {
	/** The value stored in `big_terminal_preset`. */
	value: string;
	label: string;
	command: string;
}

/** Conductor's presets, in its order, with the command shown beside each (renderApp @10676910). */
export const BIG_TERMINAL_PRESETS: readonly BigTerminalPreset[] = [
	{ value: "claude", label: "Claude", command: "claude" },
	{ value: "codex", label: "Codex", command: "codex" },
	{ value: "opencode", label: "OpenCode", command: "opencode" },
	{ value: "amp", label: "Amp", command: "amp" },
	{ value: "copilot", label: "Copilot", command: "copilot --allow-all" },
	{ value: "gemini", label: "Gemini", command: "gemini -y" },
	{ value: "none", label: "None", command: "" },
];

/** Conductor's commands when tool approvals are on, from main @437950. */
const APPROVAL_COMMANDS: Readonly<Record<string, string>> = {
	claude: "claude",
	codex: 'codex -c model_reasoning_effort="high"',
	opencode: "opencode",
	amp: "amp",
	copilot: "copilot --allow-all",
	gemini: "gemini -y",
};

/** Conductor's commands when tool approvals are off, from main @437950. */
const UNATTENDED_COMMANDS: Readonly<Record<string, string>> = {
	...APPROVAL_COMMANDS,
	claude: "claude --dangerously-skip-permissions",
	codex:
		'codex -c model_reasoning_effort="high" --ask-for-approval never --sandbox danger-full-access',
};

/** The lines of the custom command list setting, without blank ones. */
export function customTerminalCommands(value: string): string[] {
	return (typeof value === "string" ? value : "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/** The command one preset row shows beside its name. */
export function bigTerminalPresetCommand(value: string, toolApprovals: boolean): string {
	const table = toolApprovals ? APPROVAL_COMMANDS : UNATTENDED_COMMANDS;
	return table[value] ?? "";
}

/** The command a new terminal starts with: the chosen preset, or one of the user's own commands. */
export function bigTerminalCommand(
	preset: string,
	customCommands: readonly string[],
	toolApprovals: boolean,
): string | null {
	if (preset.startsWith("custom:")) {
		const index = Number(preset.slice("custom:".length));
		const command = Number.isInteger(index) ? customCommands[index] : undefined;
		return command === undefined || command === "" ? null : command;
	}
	const command = bigTerminalPresetCommand(preset, toolApprovals);
	return command === "" ? null : command;
}
