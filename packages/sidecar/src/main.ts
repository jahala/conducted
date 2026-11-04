/**
 * @feature SIDE-01 Sidecar entry point
 * Owns: choosing the mode from argv. Modes: "sidecar" (the agent host) and "logger".
 * Behaviour: research/conductor/native-and-sidecar-map.md B1. Conductor also has cli, actions,
 * internal and codex-mcp modes; cli and internal are cloud features and are left out.
 */
import { notImplemented } from "@conducted/shared";

export const MODES = ["sidecar", "logger", "app-tools-mcp"] as const;
export type Mode = (typeof MODES)[number];

export function parseMode(argv: readonly string[]): Mode | null {
	const mode = argv[2];
	return MODES.find((m) => m === mode) ?? null;
}

if (import.meta.main) {
	const mode = parseMode(process.argv);
	if (mode === null) {
		console.error(`Usage: conducted-sidecar <${MODES.join("|")}>`);
		process.exit(64);
	}
	notImplemented("SIDE-01");
}
