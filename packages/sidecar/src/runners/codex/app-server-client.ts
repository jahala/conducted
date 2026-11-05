/**
 * @feature AGENT-06 Codex: `codex app-server` JSON-RPC
 * Owns: one connection to one `codex app-server --listen stdio://` child process: starting it,
 * the initialize handshake, typed requests, a subscription for notifications and a registration
 * point for the requests the server sends us.
 * Behaviour: research/conductor/other-runners.md section 2.1: newline-delimited JSON-RPC 2.0 over
 * the child's stdio using the json-rpc-2.0 package; handshake `initialize` with client info and
 * `experimentalApi` true, then the `initialized` notification; one app-server per live chat; the
 * process is recreated if the transport closed between turns.
 * Must handle:
 *  - spawn failure or early exit: every pending request rejects as an error value, onClose fires
 *  - a request that never answers: no default timeout for turn/start and turn/steer (a turn can
 *    run for hours); a 30 s timeout for the cheap calls (model/list, account/read)
 *  - server requests (approvals, user input, elicitation): registered handlers answer them; a
 *    request with no handler is answered with a JSON-RPC "method not found" error, never ignored
 *  - the child writes non-JSON noise on stdout: logged at debug and skipped
 *  - stderr is collected (last 4 KB) for error messages
 *  - close(): end stdin, wait up to 5 s, then SIGTERM, then SIGKILL
 *  - the environment comes from the caller (shell-env), with provider secrets already removed
 * Test first: with a fake child that echoes an initialize reply, connect() sends initialize and
 * then the initialized notification, in that order.
 * Our design choice: the child process is a port (SpawnJsonRpcChild), so tests use an in-memory
 * child and production passes Bun.spawn.
 */
import type { AppError, Result } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import {
	createJSONRPCErrorResponse,
	createJSONRPCSuccessResponse,
	isJSONRPCRequest,
	isJSONRPCResponse,
	JSONRPCClient,
	JSONRPCErrorCode,
	JSONRPCErrorException,
	type JSONRPCID,
	type JSONRPCRequest,
} from "json-rpc-2.0";
import type { Logger } from "../../logging/logger.ts";
import { messageOf } from "../../util/errors.ts";
import {
	CODEX_CLIENT_METHODS,
	CODEX_INITIALIZED_NOTIFICATION,
	type CodexModelListResult,
	type CodexThreadStartParams,
	type CodexThreadStartResult,
} from "./protocol.ts";

/** The last part of stderr kept for error messages. */
export const STDERR_TAIL_CHARS = 4 * 1024;

/** How long the cheap calls (initialize, model/list, account/read) may take. */
export const CODEX_CHEAP_CALL_TIMEOUT_MS = 30_000;

/** How long the child gets to leave when the connection closes. */
export const CLOSE_GRACE_MS = 5_000;

export interface JsonRpcChild {
	writeLine(line: string): void;
	onLine(listener: (line: string) => void): void;
	onStderr(listener: (text: string) => void): void;
	onExit(listener: (exitCode: number | null, signal: string | null) => void): void;
	/** Ends stdin, waits `graceMs`, then terminates, then kills. */
	stop(graceMs: number): Promise<void>;
}

export type SpawnJsonRpcChild = (options: {
	command: string;
	args: readonly string[];
	cwd: string;
	env: Readonly<Record<string, string>>;
}) => Promise<Result<JsonRpcChild, AppError>>;

export type ServerRequestHandler = (params: unknown) => Promise<unknown>;

export interface CodexAppServerClient {
	/** Starts the process and completes the handshake. */
	connect(): Promise<Result<{ serverVersion: string }, AppError>>;
	request<T>(
		method: string,
		params: unknown,
		options?: { timeoutMs?: number },
	): Promise<Result<T, AppError>>;
	onNotification(method: string, listener: (params: unknown) => void): () => void;
	onServerRequest(method: string, handler: ServerRequestHandler): void;
	onClose(listener: (reason: string) => void): void;
	close(): Promise<void>;
}

export class JsonRpcCodexClient implements CodexAppServerClient {
	private child: JsonRpcChild | undefined;
	private rpc: JSONRPCClient<void> | undefined;
	private closedReason: string | null = null;
	private stderrTail = "";
	private readonly notificationListeners = new Map<string, Set<(params: unknown) => void>>();
	private readonly serverHandlers = new Map<string, ServerRequestHandler>();
	private readonly closeListeners: ((reason: string) => void)[] = [];

	constructor(
		protected readonly deps: {
			spawn: SpawnJsonRpcChild;
			codexPath: string;
			cwd: string;
			env: Readonly<Record<string, string>>;
			/** Extra arguments such as `--config mcp_servers.conducted.command=...` for the app tools. */
			extraArgs: readonly string[];
			clientName: string;
			clientVersion: string;
			logger: Logger;
		},
	) {}

	async connect(): Promise<Result<{ serverVersion: string }, AppError>> {
		if (this.closedReason !== null) {
			return err(appError("codex_closed", `The Codex app server is closed: ${this.closedReason}`));
		}
		if (this.child !== undefined) {
			return err(appError("codex_already_connected", "This Codex connection is already open."));
		}

		let spawned: Result<JsonRpcChild, AppError>;
		try {
			spawned = await this.deps.spawn({
				command: this.deps.codexPath,
				args: ["app-server", "--listen", "stdio://", ...this.deps.extraArgs],
				cwd: this.deps.cwd,
				env: this.deps.env,
			});
		} catch (cause) {
			const error = appError("codex_spawn_failed", messageOf(cause), cause);
			this.fireClose(error.message);
			return err(error);
		}
		if (!spawned.ok) {
			this.fireClose(spawned.error.message);
			return spawned;
		}

		const child = spawned.value;
		this.child = child;
		child.onLine((line) => this.handleLine(line));
		child.onStderr((text) => {
			this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_CHARS);
		});
		child.onExit((exitCode, signal) => {
			const ending = signal ?? (exitCode === null ? "no exit code" : String(exitCode));
			const stderr = this.stderrTail.trim();
			this.fireClose(
				stderr === ""
					? `The Codex app server exited (${ending}).`
					: `The Codex app server exited (${ending}): ${stderr}`,
			);
		});

		this.rpc = new JSONRPCClient<void>((payload) => {
			if (!this.writeLine(JSON.stringify(payload))) {
				throw new Error("The pipe to the Codex app server refused the write.");
			}
		});

		const initialized = await this.request<{ serverVersion?: unknown; userAgent?: unknown }>(
			CODEX_CLIENT_METHODS.initialize,
			{
				clientInfo: {
					name: this.deps.clientName,
					version: this.deps.clientVersion,
				},
				capabilities: { experimentalApi: true },
			},
			{ timeoutMs: CODEX_CHEAP_CALL_TIMEOUT_MS },
		);
		if (!initialized.ok) {
			await this.close();
			return initialized;
		}

		this.rpc.notify(CODEX_INITIALIZED_NOTIFICATION, {}, undefined);
		const version = initialized.value.serverVersion ?? initialized.value.userAgent;
		return ok({ serverVersion: typeof version === "string" ? version : "" });
	}

	async request<T>(
		method: string,
		params: unknown,
		options?: { timeoutMs?: number },
	): Promise<Result<T, AppError>> {
		const rpc = this.rpc;
		if (rpc === undefined) {
			return err(appError("codex_not_connected", "The Codex app server is not connected."));
		}
		if (this.closedReason !== null) {
			return err(appError("codex_closed", `The Codex app server is closed: ${this.closedReason}`));
		}
		try {
			const requester = options?.timeoutMs === undefined ? rpc : rpc.timeout(options.timeoutMs);
			const result = await requester.request(method, params, undefined);
			return ok(result as T);
		} catch (cause) {
			return err(this.toError(method, cause, options?.timeoutMs !== undefined));
		}
	}

	onNotification(method: string, listener: (params: unknown) => void): () => void {
		let listeners = this.notificationListeners.get(method);
		if (listeners === undefined) {
			listeners = new Set();
			this.notificationListeners.set(method, listeners);
		}
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	onServerRequest(method: string, handler: ServerRequestHandler): void {
		this.serverHandlers.set(method, handler);
	}

	onClose(listener: (reason: string) => void): void {
		if (this.closedReason !== null) {
			listener(this.closedReason);
			return;
		}
		this.closeListeners.push(listener);
	}

	async close(): Promise<void> {
		const child = this.child;
		if (child === undefined) {
			this.fireClose("The connection was closed.");
			return;
		}
		this.rpc?.rejectAllPendingRequests("The connection was closed.");
		try {
			await child.stop(CLOSE_GRACE_MS);
		} catch (cause) {
			this.deps.logger.error("JsonRpcAdapter: could not stop the Codex app server", {
				reason: messageOf(cause),
			});
		}
		this.fireClose("The connection was closed.");
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (trimmed === "") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			this.deps.logger.debug("JsonRpcAdapter: skipped a line that was not JSON", {
				line: trimmed.slice(0, 200),
			});
			return;
		}

		if (isJSONRPCResponse(parsed)) {
			this.rpc?.receive(parsed);
			return;
		}
		if (isJSONRPCRequest(parsed)) {
			if (parsed.id === undefined) {
				this.dispatchNotification(parsed.method, parsed.params);
				return;
			}
			this.answerServerRequest(parsed);
			return;
		}
		this.deps.logger.debug("JsonRpcAdapter: skipped a message that was not JSON-RPC", {
			line: trimmed.slice(0, 200),
		});
	}

	private dispatchNotification(method: string, params: unknown): void {
		const listeners = this.notificationListeners.get(method);
		if (listeners === undefined) return;
		for (const listener of listeners) {
			try {
				listener(params);
			} catch (cause) {
				this.deps.logger.error("JsonRpcAdapter: a Codex notification listener failed", {
					method,
					reason: messageOf(cause),
				});
			}
		}
	}

	private answerServerRequest(request: JSONRPCRequest): void {
		const id = request.id === undefined ? null : request.id;
		const handler = this.serverHandlers.get(request.method);
		if (handler === undefined) {
			this.writeResponse(
				createJSONRPCErrorResponse(
					id,
					JSONRPCErrorCode.MethodNotFound,
					`No handler for ${request.method}`,
				),
			);
			return;
		}
		void handler(request.params).then(
			(result) => {
				this.writeResponse(createJSONRPCSuccessResponse(id, result === undefined ? null : result));
			},
			(cause: unknown) => {
				this.deps.logger.error("JsonRpcAdapter: a Codex server request failed", {
					method: request.method,
					reason: messageOf(cause),
				});
				this.writeResponse(
					createJSONRPCErrorResponse(id, JSONRPCErrorCode.InternalError, messageOf(cause)),
				);
			},
		);
	}

	private writeResponse(response: unknown): void {
		if (!this.writeLine(JSON.stringify(response))) {
			this.deps.logger.error("JsonRpcAdapter: could not answer a Codex server request", {
				response: String((response as { id?: JSONRPCID }).id ?? ""),
			});
		}
	}

	private writeLine(line: string): boolean {
		const child = this.child;
		if (child === undefined) return false;
		try {
			child.writeLine(line);
			return true;
		} catch (cause) {
			this.deps.logger.error(
				"JsonRpcAdapter: the pipe to the Codex app server refused a write (backpressure)",
				{ reason: messageOf(cause) },
			);
			this.rpc?.rejectAllPendingRequests("The Codex app server stopped reading its input.");
			return false;
		}
	}

	private fireClose(reason: string): void {
		if (this.closedReason !== null) return;
		this.closedReason = reason;
		this.rpc?.rejectAllPendingRequests(reason);
		for (const listener of this.closeListeners) listener(reason);
	}

	private toError(method: string, cause: unknown, timed: boolean): AppError {
		if (cause instanceof JSONRPCErrorException) {
			if (timed && cause.message === "Request timeout") {
				return appError("codex_timeout", `Codex did not answer ${method} in time.`, cause);
			}
			return appError("codex_rpc_error", `Codex rejected ${method}: ${cause.message}`, cause);
		}
		return appError(
			"codex_request_failed",
			`Codex could not answer ${method}: ${messageOf(cause)}`,
			cause,
		);
	}
}

/** Convenience wrappers so the session reads like the protocol. */
export interface CodexCalls {
	threadStart(params: CodexThreadStartParams): Promise<Result<CodexThreadStartResult, AppError>>;
	modelList(cursor?: string): Promise<Result<CodexModelListResult, AppError>>;
}
