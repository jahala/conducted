/**
 * @feature SIDE-13 App tools over a socket bridge: the helper process
 * Owns: the "app-tools-mcp" mode of the sidecar program. It is a stdio MCP server that the agent
 * (Codex or an ACP agent) starts. It lists the app tools and forwards each call as one line to the
 * sidecar's bridge socket.
 * Behaviour: research/conductor/native-and-sidecar-map.md B5 "codex-mcp": uses the MCP SDK's
 * McpServer and stdio transport, takes --session-id and --socket, reads the token from the
 * environment, registers the same tools as the in-process server without AskUserQuestion, and
 * announces its pid with a hello.
 * Must handle:
 *  - a missing token or bad arguments: print the reason to stderr and exit with code 64
 *  - the socket is gone (sidecar quit): every call answers with an error result; the helper exits
 *    when its stdin closes (the agent ended)
 *  - one connection per call, closed after the answer
 *  - nothing on stdout except MCP frames, because stdout is the protocol channel; logs go to stderr
 *  - tool lists come from the same registry and schemas as the in-process server, so both agree
 * Test first: parseAppToolsMcpArgs is tested in mcp-launch.test.ts; here, a fake socket server
 * receives the call line for GetWorkspaceDiff with the token and session id.
 */
import { notImplemented } from "@conducted/shared";
import type { AppToolsMcpArgs } from "./mcp-launch.ts";

export interface McpStdioDeps {
	args: AppToolsMcpArgs;
	/** Value of CONDUCTED_APP_TOOLS_TOKEN. */
	token: string;
	/** Opens the bridge socket, sends one line, returns the one line that comes back. */
	callBridge(socketPath: string, line: string): Promise<string>;
	log(message: string): void;
}

/** Runs until the agent closes stdin. Returns the process exit code. */
export function runAppToolsMcp(_deps: McpStdioDeps): Promise<number> {
	return notImplemented("SIDE-13");
}
