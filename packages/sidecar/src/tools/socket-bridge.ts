/**
 * @feature SIDE-13 App tools over a socket bridge
 * Owns: the Unix socket inside the sidecar that the app-tools MCP helper (mcp-stdio-server.ts)
 * calls. It authenticates the call, finds the chat, and runs the same tool definitions as the
 * in-process server.
 * Behaviour: research/conductor/claude-runner.md section 4.3: the socket lives in a private temp
 * folder, one bridge per sidecar run; each chat gets a random token; the bridge serves Codex and
 * ACP agents and is started once per sidecar. Claude does not use it.
 * Must handle:
 *  - socket folder and file are private (mode 0700 and 0600), created per sidecar run, removed on
 *    stop(); a stale folder from a crashed run is left to the OS temp cleaner, never reused
 *  - registerSession(sessionId, appTools) returns the token for that chat; unregisterSession
 *    invalidates it (chat reset, agent restart, shutdown)
 *  - a tool that is off for the chat (appTools switches) answers with an error line, and
 *    AskUserQuestion is never offered over the bridge
 *  - tokens are compared in constant time
 *  - idle connections close after 30 s; a tool call that runs longer than that keeps its
 *    connection open until it answers (a question tool waits for a person)
 *  - a helper process that never says hello is tolerated; the pid is only logged
 *  - the app disconnects while a call waits: the call answers with the backend's error text
 * Test first: a call with the token of another chat gets an unauthorized error line and the tool
 * does not run.
 * Our design choice: tokens come from a TokenSource parameter (random bytes in production), the
 * socket folder from a TempDir parameter, and the idle limit is passed in, so tests control all
 * three.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import type { SessionConfig } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result, type SessionId } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { messageOf } from "../util/errors.ts";
import type { AppToolBackend } from "./backend.ts";
import {
	BRIDGE_IDLE_TIMEOUT_MS,
	BRIDGE_MAX_LINE_CHARS,
	type BridgeResponse,
	isHello,
	parseBridgeRequest,
} from "./bridge-protocol.ts";
import { enabledTools } from "./registry.ts";

/** The prefix the bridge folder gets in the temp folder. */
export const BRIDGE_FOLDER_PREFIX = "cmcp-";
/** The file name of the socket inside that folder. */
export const BRIDGE_SOCKET_NAME = "s";

export interface TokenSource {
	/** A new random token: BRIDGE_TOKEN_BYTES bytes, base64url encoded. */
	newToken(): string;
}

export interface BridgeEndpoint {
	socketPath: string;
}

interface RegisteredSession {
	token: string;
	appTools: SessionConfig["appTools"];
}

/** Compares two tokens without letting their first difference change how long the check takes. */
function tokensMatch(expected: string, given: string): boolean {
	const left = createHash("sha256").update(expected).digest();
	const right = createHash("sha256").update(given).digest();
	return timingSafeEqual(left, right);
}

export class AppToolsBridge {
	private server: Server | null = null;
	private folder: string | null = null;
	private endpoint: BridgeEndpoint | null = null;
	private readonly sessions = new Map<SessionId, RegisteredSession>();
	private readonly connections = new Set<Socket>();
	private readonly idleTimeoutMs: number;

	constructor(
		protected readonly deps: {
			backend: AppToolBackend;
			tokens: TokenSource;
			logger: Logger;
			/** Makes a private folder and returns its path. */
			makeTempDir(prefix: string): Promise<string>;
			/** How long a connection may stay silent. Defaults to the 30 s bridge timeout. */
			idleTimeoutMs?: number;
		},
	) {
		this.idleTimeoutMs = deps.idleTimeoutMs ?? BRIDGE_IDLE_TIMEOUT_MS;
	}

	async start(): Promise<Result<BridgeEndpoint, AppError>> {
		if (this.endpoint !== null) return ok(this.endpoint);
		let folder: string | null = null;
		let server: Server | null = null;
		try {
			folder = await this.deps.makeTempDir(BRIDGE_FOLDER_PREFIX);
			await chmod(folder, 0o700);
			const socketPath = path.join(folder, BRIDGE_SOCKET_NAME);
			server = createServer((socket) => this.handleConnection(socket));
			const listening = await this.listen(server, socketPath);
			if (!listening.ok) {
				await this.discardFolder(folder);
				return listening;
			}
			await chmod(socketPath, 0o600);
			this.server = server;
			this.folder = folder;
			this.endpoint = { socketPath };
			this.deps.logger.info("The app tools bridge is listening", { socketPath });
			return ok(this.endpoint);
		} catch (cause) {
			let cleanup = "";
			if (server !== null && server.listening) {
				try {
					await this.closeServer(server);
				} catch (closeCause) {
					cleanup = ` The socket did not close: ${messageOf(closeCause)}.`;
				}
			}
			if (folder !== null) await this.discardFolder(folder);
			return err(
				appError(
					"bridge_start_failed",
					`The app tools bridge could not start: ${messageOf(cause)}.${cleanup}`,
					cause,
				),
			);
		}
	}

	/** Returns the token the helper process must present for this chat. */
	registerSession(sessionId: SessionId, appTools: SessionConfig["appTools"]): string {
		const token = this.deps.tokens.newToken();
		this.sessions.set(sessionId, { token, appTools });
		return token;
	}

	unregisterSession(sessionId: SessionId): void {
		this.sessions.delete(sessionId);
	}

	async stop(): Promise<void> {
		const server = this.server;
		const folder = this.folder;
		this.server = null;
		this.folder = null;
		this.endpoint = null;
		this.sessions.clear();
		for (const socket of this.connections) socket.destroy();
		this.connections.clear();
		if (server !== null) await this.closeServer(server);
		if (folder !== null) await this.discardFolder(folder);
	}

	private closeServer(server: Server): Promise<void> {
		return new Promise((resolve, reject) => {
			server.close((cause) => {
				if (
					cause === undefined ||
					(cause as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING"
				) {
					resolve();
					return;
				}
				reject(cause);
			});
		});
	}

	private listen(server: Server, socketPath: string): Promise<Result<BridgeEndpoint, AppError>> {
		return new Promise((resolve) => {
			server.once("error", (cause) => {
				resolve(
					err(
						appError(
							"bridge_listen_failed",
							`The app tools bridge could not listen (${socketPath}): ${messageOf(cause)}`,
							cause,
						),
					),
				);
			});
			server.listen(socketPath, () => resolve(ok({ socketPath })));
		});
	}

	private async discardFolder(folder: string): Promise<void> {
		try {
			await rm(folder, { recursive: true, force: true });
		} catch (cause) {
			this.deps.logger.warn("The app tools bridge folder was not removed", {
				folder,
				reason: messageOf(cause),
			});
		}
	}

	private handleConnection(socket: Socket): void {
		this.connections.add(socket);
		socket.setEncoding("utf8");
		let buffer = "";
		let settled = false;
		let reading = true;
		const timer = setTimeout(() => {
			this.deps.logger.debug("An app tools bridge connection was idle", {
				timeoutMs: this.idleTimeoutMs,
			});
			socket.destroy();
		}, this.idleTimeoutMs);
		const finish = (response: BridgeResponse): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.end(`${JSON.stringify(response)}\n`);
		};
		socket.once("close", () => {
			clearTimeout(timer);
			this.connections.delete(socket);
		});
		socket.on("error", (cause) => {
			this.deps.logger.warn("An app tools bridge connection failed", {
				reason: messageOf(cause),
			});
		});
		socket.on("data", (chunk: string) => {
			if (settled || !reading) return;
			buffer += chunk;
			if (buffer.length > BRIDGE_MAX_LINE_CHARS) {
				reading = false;
				finish({ ok: false, error: "The bridge request was too long." });
				return;
			}
			const newline = buffer.indexOf("\n");
			if (newline === -1) return;
			reading = false;
			const line = buffer.slice(0, newline);
			clearTimeout(timer);
			void this.answer(line).then(finish);
		});
	}

	private async answer(line: string): Promise<BridgeResponse> {
		const parsed = parseBridgeRequest(line);
		if (!parsed.ok) {
			this.deps.logger.warn("An app tools bridge request was refused", {
				reason: parsed.error.message,
			});
			return { ok: false, error: parsed.error.message };
		}
		const request = parsed.value;
		const session = this.sessions.get(request.sessionId);
		if (session === undefined || !tokensMatch(session.token, request.authToken)) {
			this.deps.logger.warn("An app tools bridge call was not authorized", {
				sessionId: request.sessionId,
			});
			return { ok: false, error: "Unauthorized" };
		}
		if (isHello(request)) {
			this.deps.logger.info("An app tools MCP helper said hello", {
				sessionId: request.sessionId,
				pid: request.hello.pid,
			});
			return { ok: true, text: "", isError: false };
		}
		const definition = enabledTools(session.appTools, {
			includeAskUserQuestion: false,
		}).find((tool) => tool.name === request.toolName);
		if (definition === undefined) {
			return {
				ok: false,
				error: `The ${request.toolName} tool is not available in this chat.`,
			};
		}
		try {
			const result = await definition.execute(request.args as never, {
				sessionId: request.sessionId,
				backend: this.deps.backend,
			});
			return { ok: true, text: result.text, isError: result.isError };
		} catch (cause) {
			this.deps.logger.warn("An app tools bridge call failed", {
				sessionId: request.sessionId,
				tool: request.toolName,
				reason: messageOf(cause),
			});
			return { ok: false, error: messageOf(cause) };
		}
	}
}
