/**
 * @feature PLAT-28 System service: the managed programs and the Mac-level actions screens ask for
 * Owns: the display names the program list and program errors show. The system service imports
 * them.
 * Behaviour: services-map.md 4.2 (programs), ui-map.md 6 (Advanced settings).
 */
import type { ManagedProgram } from "@conducted/shared";

/** The names the program list and the program errors show. */
export const PROGRAM_DISPLAY_NAMES: Readonly<Record<ManagedProgram, string>> = {
	claude: "Claude Code",
	codex: "Codex",
	gh: "GitHub CLI (gh)",
	watchexec: "watchexec",
	cursor: "Cursor SDK",
};
