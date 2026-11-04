/**
 * @feature SIDE-13 App tools over a socket bridge: how agents start the helper
 * Owns: the MCP server entry that Codex and ACP agents are given so they can reach the app tools.
 * It is the sidecar program itself, started in "app-tools-mcp" mode.
 * Behaviour: research/conductor/other-runners.md section 2.1 (Codex gets the tools as a stdio MCP
 * server named conductor, launched through `--config mcp_servers.<name>.command/args/env`) and
 * claude-runner.md section 4.3 (the helper gets the session id and socket as arguments and the
 * token in its environment, never on the command line).
 * Must handle: a token in the environment only (a command line is visible to every process), the
 * server name from APP_TOOL_SERVER, the tool switches passed as flags, and a sidecar path with
 * spaces (kept as one argument).
 * Test first: appToolsMcpEntry never puts the token in args, and puts it in env.
 */
import { APP_TOOL_SERVER, type SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";

/** The environment variable that carries the bridge token to the helper. */
export const BRIDGE_TOKEN_ENV = "CONDUCTED_APP_TOOLS_TOKEN";

export interface McpStdioEntry {
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}

export function appToolsMcpEntry(input: {
	/** Path of the sidecar executable (process.execPath when compiled). */
	sidecarExecutable: string;
	sessionId: SessionId;
	socketPath: string;
	token: string;
	appTools: SessionConfig["appTools"];
}): McpStdioEntry {
	const args = ["app-tools-mcp", "--session-id", input.sessionId, "--socket", input.socketPath];
	if (input.appTools.diffComments) args.push("--enable-diff-comments");
	if (input.appTools.progressUpdates) args.push("--enable-progress");
	if (input.appTools.setTargetBranch) args.push("--enable-set-target-branch");
	return {
		name: APP_TOOL_SERVER,
		command: input.sidecarExecutable,
		args,
		env: { [BRIDGE_TOKEN_ENV]: input.token },
	};
}

export interface AppToolsMcpArgs {
	sessionId: SessionId;
	socketPath: string;
	appTools: SessionConfig["appTools"];
}

/** Parses the arguments after "app-tools-mcp". Returns a message when something is missing. */
export function parseAppToolsMcpArgs(
	argv: readonly string[],
): { ok: true; value: AppToolsMcpArgs } | { ok: false; message: string } {
	let sessionId: string | undefined;
	let socketPath: string | undefined;
	const appTools = { diffComments: false, progressUpdates: false, setTargetBranch: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--session-id") sessionId = argv[++i];
		else if (arg === "--socket") socketPath = argv[++i];
		else if (arg === "--enable-diff-comments") appTools.diffComments = true;
		else if (arg === "--enable-progress") appTools.progressUpdates = true;
		else if (arg === "--enable-set-target-branch") appTools.setTargetBranch = true;
		else return { ok: false, message: `Unknown argument: ${arg}` };
	}
	if (!sessionId) return { ok: false, message: "Missing --session-id" };
	if (!socketPath) return { ok: false, message: "Missing --socket" };
	return { ok: true, value: { sessionId: sessionId as SessionId, socketPath, appTools } };
}
