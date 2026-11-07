/**
 * @feature SIDE-13 App tools over a socket bridge: how agents start the helper
 * Owns: the MCP server entry that Codex and ACP agents are given so they can reach the app tools.
 * It is the sidecar program itself, started in "app-tools-mcp" mode. Also the check for a Codex
 * config that already defines the server name we reserve.
 * Behaviour: research/conductor/other-runners.md section 2.1 (Codex gets the tools as a stdio MCP
 * server named conducted, launched through `--config mcp_servers.<name>.command/args/env`, and
 * Conductor removes a clashing entry from the user's Codex config) and claude-runner.md section 4.3
 * (the helper gets the session id, socket and workspace directory as arguments and the token in
 * its environment, never on the command line).
 * Must handle: a token in the environment only (a command line is visible to every process), the
 * server name from APP_TOOL_SERVER, the tool switches passed as flags, a sidecar path with spaces
 * or quotes (one argument, written as a quoted TOML string), and a Codex config that defines the
 * reserved name as a table, a sub-table, a dotted key or a key inside `[mcp_servers]`.
 * Test first: appToolsMcpEntry never puts the token in args, and puts it in env.
 * Our design choice: the Codex app-server receives the token in its own environment, and the
 * `env_vars` config key tells Codex to pass that one variable on to the helper. Codex starts an MCP
 * stdio server with a reduced environment, so without `env_vars` the helper gets no token. Checked
 * against codex-cli 0.154.0: with the variable only in the app-server's environment the helper saw
 * none; with `env_vars` it saw the token.
 * The helper command is the sidecar's own executable. In the packaged app that is the compiled
 * sidecar; a sidecar run as `bun src/main.ts` in development hands agents the bun binary, which
 * reads `app-tools-mcp` as a script name, so the app tools need the packaged sidecar.
 * Our design choice: when the user's or the repository's Codex config already defines the reserved
 * name, we never edit that file. The chat starts without our server and a warning names the file.
 * A clashing entry would otherwise merge with ours, and codex-cli 0.154.0 then refuses its whole
 * config ("url is not supported for stdio").
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
	workspaceDir: string;
	token: string;
	appTools: SessionConfig["appTools"];
}): McpStdioEntry {
	const args = [
		"app-tools-mcp",
		"--session-id",
		input.sessionId,
		"--socket",
		input.socketPath,
		"--workspace-dir",
		input.workspaceDir,
	];
	if (input.appTools.diffComments) args.push("--enable-diff-comments");
	if (input.appTools.progressUpdates) args.push("--enable-progress");
	if (input.appTools.setTargetBranch) args.push("--enable-set-target-branch");
	if (input.appTools.localExecution === true) args.push("--enable-local-execution");
	return {
		name: APP_TOOL_SERVER,
		command: input.sidecarExecutable,
		args,
		env: { [BRIDGE_TOKEN_ENV]: input.token },
	};
}

/**
 * The `--config` arguments Codex needs for the app tools server, and the variables the app-server
 * process gets. `env_vars` names the variables Codex passes on to the helper; their values never
 * appear in a command line. Each value is a TOML string or array, written as JSON, which TOML reads
 * the same way.
 */
export function codexMcpConfig(entry: McpStdioEntry): {
	args: string[];
	env: Record<string, string>;
} {
	return {
		args: [
			"--config",
			`mcp_servers.${entry.name}.command=${JSON.stringify(entry.command)}`,
			"--config",
			`mcp_servers.${entry.name}.args=${JSON.stringify(entry.args)}`,
			"--config",
			`mcp_servers.${entry.name}.env_vars=${JSON.stringify(Object.keys(entry.env))}`,
		],
		env: entry.env,
	};
}

/** The entry as an ACP `session/new` stdio MCP server, with its environment as name-value pairs. */
export function acpMcpServer(entry: McpStdioEntry): {
	name: string;
	command: string;
	args: string[];
	env: { name: string; value: string }[];
} {
	return {
		name: entry.name,
		command: entry.command,
		args: entry.args,
		env: Object.entries(entry.env).map(([name, value]) => ({ name, value })),
	};
}

/**
 * True when a Codex config text defines an MCP server called `name`: a `[mcp_servers.<name>]`
 * table or one of its sub-tables, a dotted `mcp_servers.<name>.` key, or a `<name>` key inside the
 * `[mcp_servers]` table. Comments are ignored. It reads lines, so a file Codex itself cannot parse
 * is still checked.
 */
export function codexConfigDefinesServer(text: string, name: string): boolean {
	const quoted = escapeRegExp(name);
	const key = `(?:${quoted}|"${quoted}"|'${quoted}')`;
	// A whole line that is a table header, `[a.b]` or `[[a.b]]`, with an optional comment after it.
	const tableHeader = /^\s*\[\[?\s*([^[\]]+?)\s*\]\]?\s*(?:#.*)?$/;
	const ownTable = new RegExp(`^mcp_servers\\s*\\.\\s*${key}\\s*(?:\\.|$)`);
	const dottedKey = new RegExp(`^\\s*mcp_servers\\s*\\.\\s*${key}\\s*[.=]`);
	const keyInServers = new RegExp(`^\\s*${key}\\s*[.=]`);
	let table = "";
	for (const line of text.split(/\r?\n/)) {
		if (/^\s*#/.test(line)) continue;
		const header = tableHeader.exec(line);
		if (header !== null) {
			table = (header[1] ?? "").trim();
			if (ownTable.test(table)) return true;
			continue;
		}
		if (table === "" && dottedKey.test(line)) return true;
		if (table === "mcp_servers" && keyInServers.test(line)) return true;
	}
	return false;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface AppToolsMcpArgs {
	sessionId: SessionId;
	socketPath: string;
	workspaceDir: string;
	appTools: SessionConfig["appTools"];
}

/** Parses the arguments after "app-tools-mcp". Returns a message when something is missing. */
export function parseAppToolsMcpArgs(
	argv: readonly string[],
): { ok: true; value: AppToolsMcpArgs } | { ok: false; message: string } {
	let sessionId: string | undefined;
	let socketPath: string | undefined;
	let workspaceDir: string | undefined;
	const appTools = {
		diffComments: false,
		progressUpdates: false,
		setTargetBranch: false,
		localExecution: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--session-id") sessionId = argv[++i];
		else if (arg === "--socket") socketPath = argv[++i];
		else if (arg === "--workspace-dir") workspaceDir = argv[++i];
		else if (arg === "--enable-diff-comments") appTools.diffComments = true;
		else if (arg === "--enable-progress") appTools.progressUpdates = true;
		else if (arg === "--enable-set-target-branch") appTools.setTargetBranch = true;
		else if (arg === "--enable-local-execution") appTools.localExecution = true;
		else return { ok: false, message: `Unknown argument: ${arg}` };
	}
	if (!sessionId) return { ok: false, message: "Missing --session-id" };
	if (!socketPath) return { ok: false, message: "Missing --socket" };
	if (!workspaceDir) return { ok: false, message: "Missing --workspace-dir" };
	return {
		ok: true,
		value: { sessionId: sessionId as SessionId, socketPath, workspaceDir, appTools },
	};
}
