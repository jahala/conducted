/**
 * @feature SIDE-13 App tools over a socket bridge: entry of the helper mode
 * Owns: the "app-tools-mcp" mode: reading its arguments and token, then running the stdio MCP
 * server in tools/mcp-stdio-server.ts.
 * Behaviour: research/conductor/native-and-sidecar-map.md B5 "codex-mcp" and B1 (a mode with no
 * wrapper script, started directly by the agent's config).
 * Must handle: bad arguments or a missing token (a message on stderr, exit 64; never on stdout,
 * which is the MCP channel), and nothing else on stdout.
 * Test first: with no arguments the mode returns 64 and writes the reason to stderr only.
 * Our design choice: the writers and the server runner are parameters, so a test drives the mode
 * without a real agent process.
 */
import { EXIT_USAGE } from "../exit-codes.ts";
import { BRIDGE_TOKEN_ENV, parseAppToolsMcpArgs } from "../tools/mcp-launch.ts";
import {
	callBridgeOverSocket,
	type McpStdioDeps,
	runAppToolsMcp,
} from "../tools/mcp-stdio-server.ts";

export interface AppToolsMcpModeIo {
	writeError(text: string): void;
	runServer(deps: McpStdioDeps): Promise<number>;
}

export function runAppToolsMcpMode(
	env: Readonly<Record<string, string | undefined>>,
	args: readonly string[],
	io: Partial<AppToolsMcpModeIo> = {},
): Promise<number> {
	const writeError =
		io.writeError ??
		((text: string): void => {
			process.stderr.write(text);
		});
	const parsed = parseAppToolsMcpArgs(args);
	if (!parsed.ok) {
		writeError(`${parsed.message}\n`);
		return Promise.resolve(EXIT_USAGE);
	}
	const token = env[BRIDGE_TOKEN_ENV];
	if (token === undefined || token === "") {
		writeError(`${BRIDGE_TOKEN_ENV} is missing.\n`);
		return Promise.resolve(EXIT_USAGE);
	}
	return (io.runServer ?? runAppToolsMcp)({
		args: parsed.value,
		token,
		callBridge: callBridgeOverSocket,
		log: (message) => {
			writeError(`${message}\n`);
		},
	});
}
