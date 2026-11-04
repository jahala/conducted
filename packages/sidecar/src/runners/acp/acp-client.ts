/**
 * @feature AGENT-11 ACP client and runner: the wire client
 * Owns: one connection to one ACP agent process: spawn, initialize, session calls, and the
 * requests the agent sends back to us.
 * Behaviour: research/conductor/other-runners.md section 2.2: one child process per chat (stdio
 * pipes); `initialize` with protocol version 1, client capabilities for file reads and writes and
 * form elicitation, and a client info name; session calls new, load, resume, prompt, cancel,
 * set_config_option, set_mode, close; the agent calls back with session/update,
 * session/request_permission, elicitation/create, fs/read_text_file and fs/write_text_file. We use
 * the connection helpers of @agentclientprotocol/sdk (ndJsonStream and the client builder).
 * Must handle:
 *  - resume order: session/resume if the agent advertises it, else session/load, else warn and
 *    start a new session (and say so through the callback, so the history gap is visible)
 *  - fs/read_text_file and fs/write_text_file are answered by us and restricted to the workspace
 *    folder and the additional directories (real paths); anything else is an error reply
 *  - a prompt is text only; attachments are already listed in the text by prompt/
 *  - session/cancel is a notification; open permission and elicitation requests are resolved as
 *    cancelled by the session (acp-session.ts)
 *  - the child exits or the pipe breaks: pending requests fail with an error value, onClose fires
 *  - the agent version is below the adapter's minimum: connect() returns "update needed"
 *  - stderr of the child is kept (last 4 KB) for error messages
 * Test first: with an in-memory agent that advertises session/resume, openSession with a resume id
 * calls session/resume and not session/load.
 * Our design choice: the child process is a port (SpawnAcpChild), as for Codex.
 */
import type {
	ContentBlock,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionConfigOption,
	SessionNotification,
	StopReason,
} from "@agentclientprotocol/sdk";
import type { AppError, Result } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";

export interface AcpChild {
	/** The child's stdin and stdout as web streams, for ndJsonStream. */
	stdin: WritableStream<Uint8Array>;
	stdout: ReadableStream<Uint8Array>;
	onStderr(listener: (text: string) => void): void;
	onExit(listener: (exitCode: number | null, signal: string | null) => void): void;
	stop(graceMs: number): Promise<void>;
}

export type SpawnAcpChild = (options: {
	command: string;
	args: readonly string[];
	cwd: string;
	env: Readonly<Record<string, string>>;
}) => Promise<Result<AcpChild, AppError>>;

/** What the agent can call on us. The session provides these. */
export interface AcpClientHandlers {
	onSessionUpdate(notification: SessionNotification): void;
	requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse>;
	readTextFile(path: string): Promise<Result<string, AppError>>;
	writeTextFile(path: string, content: string): Promise<Result<void, AppError>>;
}

export interface OpenedAcpSession {
	acpSessionId: string;
	/** How the session was obtained. "new" after a failed resume means history was lost. */
	how: "new" | "resumed" | "loaded";
	configOptions: SessionConfigOption[];
}

export interface AcpClient {
	connect(): Promise<Result<{ agentVersion: string | undefined }, AppError>>;
	openSession(options: {
		cwd: string;
		additionalDirectories: readonly string[];
		resumeSessionId?: string;
		mcpServers: readonly unknown[];
	}): Promise<Result<OpenedAcpSession, AppError>>;
	/** Resolves with the stop reason when the agent ends the turn. */
	prompt(acpSessionId: string, content: ContentBlock[]): Promise<Result<StopReason, AppError>>;
	cancel(acpSessionId: string): void;
	setConfigOption(
		acpSessionId: string,
		optionId: string,
		value: string | boolean,
	): Promise<Result<void, AppError>>;
	setMode(acpSessionId: string, modeId: string): Promise<Result<void, AppError>>;
	onClose(listener: (reason: string) => void): void;
	close(): Promise<void>;
}

export class StdioAcpClient implements AcpClient {
	constructor(
		protected readonly deps: {
			spawn: SpawnAcpChild;
			adapter: AcpAdapter;
			executablePath: string;
			cwd: string;
			env: Readonly<Record<string, string>>;
			handlers: AcpClientHandlers;
			logger: Logger;
		},
	) {}

	connect(): Promise<Result<{ agentVersion: string | undefined }, AppError>> {
		return notImplemented("AGENT-11");
	}

	openSession(_options: {
		cwd: string;
		additionalDirectories: readonly string[];
		resumeSessionId?: string;
		mcpServers: readonly unknown[];
	}): Promise<Result<OpenedAcpSession, AppError>> {
		return notImplemented("AGENT-11");
	}

	prompt(_acpSessionId: string, _content: ContentBlock[]): Promise<Result<StopReason, AppError>> {
		return notImplemented("AGENT-11");
	}

	cancel(_acpSessionId: string): void {
		notImplemented("AGENT-11");
	}

	setConfigOption(
		_acpSessionId: string,
		_optionId: string,
		_value: string | boolean,
	): Promise<Result<void, AppError>> {
		return notImplemented("AGENT-11");
	}

	setMode(_acpSessionId: string, _modeId: string): Promise<Result<void, AppError>> {
		return notImplemented("AGENT-11");
	}

	onClose(_listener: (reason: string) => void): void {
		notImplemented("AGENT-11");
	}

	close(): Promise<void> {
		return notImplemented("AGENT-11");
	}
}
