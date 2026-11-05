/**
 * @feature SIDE-13 App tools over a socket bridge: the helper process
 * Owns: the "app-tools-mcp" mode of the sidecar program. It is a stdio MCP server that the agent
 * (Codex or an ACP agent) starts. It lists the app tools and forwards each call as one line to the
 * sidecar's bridge socket.
 * Behaviour: research/conductor/native-and-sidecar-map.md B5 "codex-mcp": uses the MCP SDK's
 * McpServer and stdio transport, takes --session-id, --socket and --workspace-dir, reads the token
 * from the environment, registers the same tools as the in-process server without AskUserQuestion,
 * and announces its pid with a hello.
 * Must handle:
 *  - a missing token or bad arguments: print the reason to stderr and exit with code 64 (the mode)
 *  - the socket is gone (sidecar quit): every call answers with an error result; the helper exits
 *    when its stdin closes (the agent ended)
 *  - one connection per call, closed after the answer
 *  - nothing on stdout except MCP frames, because stdout is the protocol channel; logs go to stderr
 *  - tool lists come from the same registry and schemas as the in-process server, so both agree
 * Test first: a fake socket server receives the call line for GetWorkspaceDiff with the token and
 * session id.
 * Our design choice: the socket call and the stdio streams are parameters, so a test drives the
 * helper without a real agent process.
 */
import { createConnection } from "node:net";
import type { Readable, Writable } from "node:stream";
import { APP_TOOL_SERVER } from "@conducted/protocol";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { messageOf } from "../util/errors.ts";
import { zBridgeResponse } from "./bridge-protocol.ts";
import type { AppToolsMcpArgs } from "./mcp-launch.ts";
import { enabledTools } from "./registry.ts";

export interface McpStdioDeps {
	args: AppToolsMcpArgs;
	/** Value of CONDUCTED_APP_TOOLS_TOKEN. */
	token: string;
	/** Opens the bridge socket, sends one line, returns the one line that comes back. */
	callBridge(socketPath: string, line: string): Promise<string>;
	log(message: string): void;
	/** Defaults to process.stdin. */
	stdin?: Readable;
	/** Defaults to process.stdout. */
	stdout?: Writable;
	/** Sent in the hello. Defaults to process.pid. */
	pid?: number;
}

/** Sends one line to the bridge over a fresh socket and returns the line that comes back. */
export function callBridgeOverSocket(socketPath: string, line: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.setEncoding("utf8");
		let received = "";
		let settled = false;
		const settle = (finish: () => void): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			finish();
		};
		socket.once("connect", () => socket.write(`${line}\n`));
		socket.on("data", (chunk: string) => {
			received += chunk;
			const newline = received.indexOf("\n");
			if (newline === -1) return;
			settle(() => resolve(received.slice(0, newline)));
		});
		socket.once("error", (cause) => settle(() => reject(cause)));
		socket.once("close", () =>
			settle(() => reject(new Error("The app tools bridge closed without an answer."))),
		);
	});
}

/** The line the helper sends when it starts, so the sidecar can log which process is connected. */
export function helloLine(args: AppToolsMcpArgs, token: string, pid: number): string {
	return JSON.stringify({
		authToken: token,
		sessionId: args.sessionId,
		hello: { pid },
	});
}

interface ToolCallResult {
	text: string;
	isError: boolean;
}

async function callTool(
	deps: Pick<McpStdioDeps, "args" | "token" | "callBridge" | "log">,
	toolName: string,
	args: unknown,
): Promise<ToolCallResult> {
	const line = JSON.stringify({
		authToken: deps.token,
		sessionId: deps.args.sessionId,
		toolName,
		args,
	});
	let answer: string;
	try {
		answer = await deps.callBridge(deps.args.socketPath, line);
	} catch (cause) {
		const message = messageOf(cause);
		deps.log(`The app tools bridge call failed: ${message}`);
		return { text: message, isError: true };
	}
	let json: unknown;
	try {
		json = JSON.parse(answer);
	} catch (cause) {
		const message = `The app tools bridge sent an unreadable answer: ${messageOf(cause)}`;
		deps.log(message);
		return { text: message, isError: true };
	}
	const parsed = zBridgeResponse.safeParse(json);
	if (!parsed.success) {
		const message = "The app tools bridge sent an invalid answer.";
		deps.log(message);
		return { text: message, isError: true };
	}
	const response = parsed.data;
	if (!response.ok) {
		deps.log(`The app tools bridge refused a call: ${response.error}`);
		return { text: response.error, isError: true };
	}
	return { text: response.text, isError: response.isError };
}

/** Builds the MCP server the helper exposes, from the same registry the in-process server uses. */
export function createAppToolsMcpServer(
	deps: Pick<McpStdioDeps, "args" | "token" | "callBridge" | "log">,
): McpServer {
	const server = new McpServer({ name: APP_TOOL_SERVER, version: "1.0.0" });
	for (const definition of enabledTools(deps.args.appTools, {
		includeAskUserQuestion: false,
	})) {
		server.registerTool(
			definition.name,
			{
				description: definition.description,
				inputSchema: definition.inputShape,
				annotations: {
					readOnlyHint: definition.readOnly,
					destructiveHint: !definition.readOnly,
					idempotentHint: definition.idempotent,
					openWorldHint: false,
				},
			},
			async (args) => {
				const result = await callTool(deps, definition.name, args);
				return {
					content: [{ type: "text" as const, text: result.text }],
					isError: result.isError,
				};
			},
		);
	}
	return server;
}

async function announce(
	deps: Pick<McpStdioDeps, "args" | "token" | "callBridge" | "log" | "pid">,
): Promise<void> {
	const line = helloLine(deps.args, deps.token, deps.pid ?? process.pid);
	try {
		const answer = await deps.callBridge(deps.args.socketPath, line);
		const parsed = zBridgeResponse.safeParse(JSON.parse(answer));
		if (!parsed.success || !parsed.data.ok) {
			const reason =
				parsed.success && !parsed.data.ok
					? parsed.data.error
					: "The bridge sent an invalid answer.";
			deps.log(`The app tools bridge did not accept the hello: ${reason}`);
		}
	} catch (cause) {
		deps.log(`The app tools bridge did not accept the hello: ${messageOf(cause)}`);
	}
}

function streamClosed(stream: Readable): Promise<void> {
	if (stream.readableEnded) return Promise.resolve();
	return new Promise((resolve) => {
		stream.once("end", resolve);
		stream.once("close", resolve);
	});
}

/** Runs until the agent closes stdin. Returns the process exit code. */
export async function runAppToolsMcp(deps: McpStdioDeps): Promise<number> {
	const stdin = deps.stdin ?? process.stdin;
	const stdout = deps.stdout ?? process.stdout;
	const server = createAppToolsMcpServer(deps);
	await announce(deps);
	const transport = new StdioServerTransport(stdin, stdout);
	await server.connect(transport);
	try {
		await streamClosed(stdin);
	} finally {
		await server.close();
	}
	return 0;
}
