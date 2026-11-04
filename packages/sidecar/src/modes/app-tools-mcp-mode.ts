/**
 * @feature SIDE-13 App tools over a socket bridge: entry of the helper mode
 * Owns: the "app-tools-mcp" mode: reading its arguments and token, then running the stdio MCP
 * server in tools/mcp-stdio-server.ts.
 * Behaviour: research/conductor/native-and-sidecar-map.md B5 "codex-mcp" and B1 (a mode with no
 * wrapper script, started directly by the agent's config).
 * Must handle: bad arguments or a missing token (a message on stderr, exit 64; never on stdout,
 * which is the MCP channel), and nothing else on stdout.
 * Test first: with no arguments the mode returns 64 and writes the reason to stderr only.
 */
import { notImplemented } from "@conducted/shared";

export function runAppToolsMcpMode(
	_env: Readonly<Record<string, string | undefined>>,
	_args: readonly string[],
): Promise<number> {
	return notImplemented("SIDE-13");
}
