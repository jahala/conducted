/**
 * @feature SIDE-01 Entry point and modes
 * Owns: choosing the mode from argv and running it. Modes: "sidecar" (the agent host), "logger"
 * (the log collector) and "app-tools-mcp" (the helper that gives Codex and ACP agents the app
 * tools).
 * Behaviour: research/conductor/native-and-sidecar-map.md B1. Conductor also has cli, actions,
 * internal and codex-mcp modes; cli and internal are cloud features and are left out, actions is
 * an internal-user test bridge, and codex-mcp is our app-tools-mcp.
 * Must handle: no mode or an unknown mode (usage on stderr, exit 64), a mode that rejects
 * (the error is printed to stderr and the exit code is 1), and `--version` as the first argument
 * (prints the version and exits 0; SIDE-23, in packaging.ts).
 * Test first: dispatchMode with an unknown mode returns 64 without calling any runner.
 * Our design choice: the entry only dispatches. All behaviour lives in modes/, so tests call the
 * mode functions without starting a process.
 */
import { runAppToolsMcpMode } from "./modes/app-tools-mcp-mode.ts";
import { runLoggerMode } from "./modes/logger-mode.ts";
import { runSidecarMode } from "./modes/sidecar-mode.ts";
import { printVersion, VERSION_FLAG } from "./packaging.ts";

export const MODES = ["sidecar", "logger", "app-tools-mcp"] as const;
export type Mode = (typeof MODES)[number];

export function parseMode(argv: readonly string[]): Mode | null {
	const mode = argv[2];
	return MODES.find((m) => m === mode) ?? null;
}

export type ModeRunner = (
	env: Readonly<Record<string, string | undefined>>,
	args: readonly string[],
) => Promise<number>;

/** Exit code for a wrong command line (EX_USAGE in sysexits.h). */
export const EXIT_USAGE = 64;

export async function dispatchMode(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
	runners: Readonly<Record<Mode, ModeRunner>>,
	writeError: (text: string) => void,
): Promise<number> {
	const mode = parseMode(argv);
	if (mode === null) {
		writeError(`Usage: conducted-sidecar <${MODES.join("|")}>\n`);
		return EXIT_USAGE;
	}
	try {
		return await runners[mode](env, argv.slice(3));
	} catch (cause) {
		writeError(`${cause instanceof Error ? cause.message : String(cause)}\n`);
		return 1;
	}
}

if (import.meta.main) {
	if (process.argv[2] === VERSION_FLAG) {
		process.exit(printVersion((text) => process.stdout.write(text)));
	}
	const code = await dispatchMode(
		process.argv,
		process.env,
		{
			sidecar: runSidecarMode,
			logger: runLoggerMode,
			"app-tools-mcp": runAppToolsMcpMode,
		},
		(text) => process.stderr.write(text),
	);
	process.exit(code);
}
