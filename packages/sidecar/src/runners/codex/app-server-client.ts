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
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type {
	CodexModelListResult,
	CodexThreadStartParams,
	CodexThreadStartResult,
} from "./protocol.ts";

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

	connect(): Promise<Result<{ serverVersion: string }, AppError>> {
		return notImplemented("AGENT-06");
	}

	request<T>(
		_method: string,
		_params: unknown,
		_options?: { timeoutMs?: number },
	): Promise<Result<T, AppError>> {
		return notImplemented("AGENT-06");
	}

	onNotification(_method: string, _listener: (params: unknown) => void): () => void {
		return notImplemented("AGENT-06");
	}

	onServerRequest(_method: string, _handler: ServerRequestHandler): void {
		notImplemented("AGENT-06");
	}

	onClose(_listener: (reason: string) => void): void {
		notImplemented("AGENT-06");
	}

	close(): Promise<void> {
		return notImplemented("AGENT-06");
	}
}

/** Convenience wrappers so the session reads like the protocol. */
export interface CodexCalls {
	threadStart(params: CodexThreadStartParams): Promise<Result<CodexThreadStartResult, AppError>>;
	modelList(cursor?: string): Promise<Result<CodexModelListResult, AppError>>;
}
