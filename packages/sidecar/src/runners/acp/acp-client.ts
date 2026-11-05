/**
 * @feature AGENT-11 ACP client and runner: the wire client
 * Owns: one connection to one ACP agent process: spawn, initialize, session calls, the
 * requests the agent sends back to us, and the file access it asks us for.
 * Behaviour: research/conductor/other-runners.md section 2.2: one child process per chat (stdio
 * pipes); `initialize` with protocol version 1, client capabilities for file reads and writes,
 * form elicitation and boolean config options, and a client info name; session calls new, load,
 * resume, prompt, cancel, set_config_option, set_mode, close; the agent calls back with
 * session/update, session/request_permission, elicitation/create, fs/read_text_file and
 * fs/write_text_file. We use the connection helpers of @agentclientprotocol/sdk (ndJsonStream and
 * the client builder).
 * Must handle:
 *  - resume order: session/resume if the agent advertises it, else session/load, else warn and
 *    start a new session (acp-session.ts shows the user the history gap)
 *  - fs/read_text_file and fs/write_text_file are answered by us and restricted to the workspace
 *    folder and the additional directories (real paths); anything else is an error reply
 *  - a read is cut at 256 KiB with the file's size in the note; a line and a limit pick a slice
 *  - a write waits for the session's beforeFirstWrite callback
 *  - a prompt is text only; attachments are already listed in the text by prompt/
 *  - session/cancel is a notification; open permission and elicitation requests are resolved as
 *    cancelled by the session (acp-session.ts)
 *  - the child exits or the pipe breaks: pending requests fail with an error value, onClose fires
 *  - stderr of the child is kept (last 4 KB) for error messages
 *  - a missing program, a sign-in error, a credit error, a rate limit and a bare "Internal error"
 *    become messages a person can act on
 *  - closing waits at most 1 s for session/close and at most 1 s for stdin to end, then stops the
 *    child
 * Test first: with an in-memory agent that advertises session/resume, openSession with a resume id
 * calls session/resume and not session/load.
 * Our design choice: the child process is a port (SpawnAcpChild), as for Codex. The file system is
 * read through node:fs because this module is the side effect edge for ACP file access.
 */

import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
	type ClientConnection,
	type ContentBlock,
	type CreateElicitationRequest,
	type CreateElicitationResponse,
	client as createClientApp,
	type FileSystemCapabilities,
	type InitializeResponse,
	type LoadSessionResponse,
	type McpCapabilities,
	type NewSessionResponse,
	ndJsonStream,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type ResumeSessionResponse,
	type SessionConfigOption,
	type SessionNotification,
	type StopReason,
} from "@agentclientprotocol/sdk";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { isMissingFile, messageOf } from "../../util/errors.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";
import { ACP_AGENT_METHODS, ACP_CLIENT_METHODS } from "./methods.ts";

/** Our client name in the ACP initialize handshake. */
export const ACP_CLIENT_NAME = "conducted";
/** Our client version in the initialize handshake. */
export const ACP_CLIENT_VERSION = "0.1.0";
/** The most a file read returns before it is cut. */
export const ACP_FILE_READ_LIMIT_BYTES = 256 * 1024;
/** The most stderr text kept for an error message. */
export const ACP_STDERR_TAIL_BYTES = 4 * 1024;
/** How long closing waits for session/close, and for stdin to end. */
export const ACP_CLOSE_TIMEOUT_MS = 1_000;

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
	requestElicitation(request: CreateElicitationRequest): Promise<CreateElicitationResponse>;
	/** Runs before the first file write, so the start checkpoint exists. */
	beforeWrite?(): Promise<void>;
	/** The last agent text, used to replace a bare "Internal error". */
	lastOutput?(): string;
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
	setConfigOptions?(options: SessionConfigOption[]): void;
	onClose(listener: (reason: string) => void): void;
	close(): Promise<void>;
}

interface FailureContext {
	adapter: AcpAdapter;
	authMethods?: readonly string[];
	stderrTail?: string;
	lastOutput?: string;
}

/** A short message a person can act on, from an ACP JSON-RPC failure. */
export function describeAcpFailure(
	cause: unknown,
	context: FailureContext,
): { code: string; message: string; retryable: boolean } {
	const text = failureText(cause);
	const lower = text.toLowerCase();
	const code = failureCode(cause);
	const provider = context.adapter.displayName;
	if (
		code === -32000 ||
		/sign.?in|not signed in|unauthori[sz]ed|authentication required/.test(lower)
	) {
		const methods = (context.authMethods ?? []).filter((method) => method !== "");
		const how = methods.length > 0 ? ` Sign-in methods: ${methods.join(", ")}.` : "";
		return {
			code: "acp_auth_required",
			message: `The ${provider} agent needs sign-in. Sign in with ${provider} and try again.${how}`,
			retryable: false,
		};
	}
	if (/credit|quota|payment|billing|insufficient funds|out of credits|usage limit/.test(lower)) {
		return {
			code: "acp_credits",
			message: `The ${provider} provider is out of credits. Add credits or choose another model.`,
			retryable: false,
		};
	}
	if (code === 429 || /rate.?limit|too many requests|\b429\b/.test(lower)) {
		return {
			code: "acp_rate_limit",
			message: `The ${provider} agent is busy right now. Try again in a moment, or choose another model.`,
			retryable: true,
		};
	}
	if (/^internal (server )?error[.!]?$/.test(lower.trim())) {
		const replacement = context.lastOutput?.trim() || context.stderrTail?.trim();
		return {
			code: "acp_internal",
			message:
				replacement === undefined || replacement === ""
					? `The ${provider} agent stopped with an internal error.`
					: replacement,
			retryable: false,
		};
	}
	return { code: "acp_failed", message: text, retryable: false };
}

function failureText(cause: unknown): string {
	if (typeof cause === "object" && cause !== null && "message" in cause) {
		const message = (cause as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return messageOf(cause);
}

function failureCode(cause: unknown): number | undefined {
	if (typeof cause === "object" && cause !== null && "code" in cause) {
		const code = (cause as { code?: unknown }).code;
		if (typeof code === "number") return code;
	}
	return undefined;
}

/** True when the failure may go away if the user tries the same turn again. */
export function isRetryableAcpCode(code: string): boolean {
	return code === "acp_rate_limit";
}

/**
 * Keeps only the MCP servers the agent advertised. Stdio is part of the baseline, so it always
 * stays; HTTP and SSE are offered only when the agent's initialize result names them.
 */
export function selectMcpServersByCapability(
	servers: readonly unknown[],
	capabilities: McpCapabilities | undefined,
): unknown[] {
	return servers.filter((server) => {
		if (typeof server !== "object" || server === null) return true;
		const transport = (server as { type?: unknown }).type;
		if (transport === "http") return capabilities?.http === true;
		if (transport === "sse") return capabilities?.sse === true;
		return true;
	});
}

interface Opened {
	connection: ClientConnection;
	child: AcpChild;
}

export class StdioAcpClient implements AcpClient {
	private opened: Opened | null = null;
	private connecting: Promise<Result<{ agentVersion: string | undefined }, AppError>> | null = null;
	private agentVersion: string | undefined;
	private agentCapabilities: InitializeResponse["agentCapabilities"] = undefined;
	private authMethods: string[] = [];
	private sessionId: string | null = null;
	private configOptions: SessionConfigOption[] = [];
	private allowedRoots: string[] = [];
	private stderrTail = "";
	private closeListeners: ((reason: string) => void)[] = [];
	private closing = false;

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
	) {
		this.allowedRoots = [resolve(deps.cwd)];
	}

	connect(): Promise<Result<{ agentVersion: string | undefined }, AppError>> {
		if (this.opened !== null) return Promise.resolve(ok({ agentVersion: this.agentVersion }));
		if (this.connecting !== null) return this.connecting;
		const started = this.openConnection().finally(() => {
			if (this.connecting === started) this.connecting = null;
		});
		this.connecting = started;
		return started;
	}

	async openSession(options: {
		cwd: string;
		additionalDirectories: readonly string[];
		resumeSessionId?: string;
		mcpServers: readonly unknown[];
	}): Promise<Result<OpenedAcpSession, AppError>> {
		const connected = await this.connect();
		if (!connected.ok) return connected;
		const connection = this.opened?.connection;
		if (connection === undefined) {
			return err(appError("acp_not_connected", "The ACP agent is not connected."));
		}
		this.allowedRoots = await this.realRoots([options.cwd, ...options.additionalDirectories]);
		const base = {
			cwd: options.cwd,
			additionalDirectories: [...options.additionalDirectories],
			mcpServers: selectMcpServersByCapability(
				options.mcpServers,
				this.agentCapabilities?.mcpCapabilities,
			),
		} as {
			cwd: string;
			additionalDirectories: string[];
			mcpServers: unknown[];
		};

		const resumeId = options.resumeSessionId;
		if (resumeId !== undefined && resumeId !== "") {
			if (this.agentCapabilities?.sessionCapabilities?.resume) {
				try {
					const response = await connection.agent.request<ResumeSessionResponse>(
						ACP_AGENT_METHODS.sessionResume,
						{ ...base, sessionId: resumeId },
					);
					this.sessionId = resumeId;
					this.configOptions = response.configOptions ?? [];
					return ok({
						acpSessionId: resumeId,
						how: "resumed",
						configOptions: this.configOptions,
					});
				} catch (cause) {
					this.deps.logger.warn("The ACP agent could not resume the session", {
						adapter: this.deps.adapter.id,
						reason: failureText(cause),
					});
				}
			}
			if (this.agentCapabilities?.loadSession) {
				try {
					const response = await connection.agent.request<LoadSessionResponse>(
						ACP_AGENT_METHODS.sessionLoad,
						{ ...base, sessionId: resumeId },
					);
					this.sessionId = resumeId;
					this.configOptions = response.configOptions ?? [];
					return ok({
						acpSessionId: resumeId,
						how: "loaded",
						configOptions: this.configOptions,
					});
				} catch (cause) {
					this.deps.logger.warn("The ACP agent could not load the session", {
						adapter: this.deps.adapter.id,
						reason: failureText(cause),
					});
				}
			}
		}

		try {
			const response = await connection.agent.request<NewSessionResponse>(
				ACP_AGENT_METHODS.sessionNew,
				base,
			);
			if (typeof response.sessionId !== "string" || response.sessionId === "") {
				return err(
					appError(
						"acp_bad_session",
						`The ${this.deps.adapter.displayName} agent did not return a session id.`,
					),
				);
			}
			this.sessionId = response.sessionId;
			this.configOptions = response.configOptions ?? [];
			return ok({
				acpSessionId: response.sessionId,
				how: "new",
				configOptions: this.configOptions,
			});
		} catch (cause) {
			return err(this.failure(cause));
		}
	}

	async prompt(
		acpSessionId: string,
		content: ContentBlock[],
	): Promise<Result<StopReason, AppError>> {
		const connection = this.opened?.connection;
		if (connection === undefined) {
			return err(appError("acp_not_connected", "The ACP agent is not connected."));
		}
		try {
			const response = await connection.agent.request<{ stopReason: StopReason }>(
				ACP_AGENT_METHODS.sessionPrompt,
				{ sessionId: acpSessionId, prompt: content },
			);
			return ok(response.stopReason);
		} catch (cause) {
			return err(this.failure(cause));
		}
	}

	cancel(acpSessionId: string): void {
		const connection = this.opened?.connection;
		if (connection === undefined) return;
		void connection.agent
			.notify(ACP_AGENT_METHODS.sessionCancel, { sessionId: acpSessionId })
			.catch((cause: unknown) => {
				this.deps.logger.warn("The ACP cancel notification could not be sent", {
					adapter: this.deps.adapter.id,
					reason: failureText(cause),
				});
			});
	}

	async setConfigOption(
		acpSessionId: string,
		optionId: string,
		value: string | boolean,
	): Promise<Result<void, AppError>> {
		const connection = this.opened?.connection;
		if (connection === undefined) {
			return err(appError("acp_not_connected", "The ACP agent is not connected."));
		}
		try {
			const params =
				typeof value === "boolean"
					? { sessionId: acpSessionId, configId: optionId, type: "boolean" as const, value }
					: { sessionId: acpSessionId, configId: optionId, value };
			const response = await connection.agent.request<{
				configOptions?: SessionConfigOption[];
			}>(ACP_AGENT_METHODS.sessionSetConfigOption, params);
			if (response.configOptions !== undefined) this.configOptions = response.configOptions;
			return ok(undefined);
		} catch (cause) {
			return err(this.failure(cause));
		}
	}

	async setMode(acpSessionId: string, modeId: string): Promise<Result<void, AppError>> {
		const connection = this.opened?.connection;
		if (connection === undefined) {
			return err(appError("acp_not_connected", "The ACP agent is not connected."));
		}
		try {
			await connection.agent.request(ACP_AGENT_METHODS.sessionSetMode, {
				sessionId: acpSessionId,
				modeId,
			});
			return ok(undefined);
		} catch (cause) {
			return err(this.failure(cause));
		}
	}

	setConfigOptions(options: SessionConfigOption[]): void {
		this.configOptions = options;
	}

	onClose(listener: (reason: string) => void): void {
		this.closeListeners.push(listener);
	}

	async close(): Promise<void> {
		if (this.closing) return;
		this.closing = true;
		const opened = this.opened;
		this.opened = null;
		if (opened === null) return;

		if (this.sessionId !== null && this.agentCapabilities?.sessionCapabilities?.close) {
			const closed = await settleWithin(
				opened.connection.agent.request(ACP_AGENT_METHODS.sessionClose, {
					sessionId: this.sessionId,
				}),
				ACP_CLOSE_TIMEOUT_MS,
			);
			if (closed === "timeout") {
				this.deps.logger.warn("The ACP agent did not close its session in time", {
					adapter: this.deps.adapter.id,
				});
			} else if (closed === "failed") {
				this.deps.logger.warn("The ACP agent refused to close its session", {
					adapter: this.deps.adapter.id,
				});
			}
		}

		opened.connection.close();
		const ended = await settleWithin(opened.child.stdin.close(), ACP_CLOSE_TIMEOUT_MS);
		if (ended === "timeout") {
			this.deps.logger.warn("The ACP agent did not accept end of input in time", {
				adapter: this.deps.adapter.id,
			});
		}
		await opened.child.stop(ACP_CLOSE_TIMEOUT_MS);
	}

	private async openConnection(): Promise<Result<{ agentVersion: string | undefined }, AppError>> {
		const command = this.deps.adapter.command;
		const spawned = await this.deps.spawn({
			command: this.deps.executablePath,
			args: command.args,
			cwd: this.deps.cwd,
			env: this.deps.env,
		});
		if (!spawned.ok) {
			return err(
				appError(
					"acp_start_failed",
					`The ${this.deps.adapter.displayName} agent could not start (${command.executable}). Install it, or repair its path in Settings.`,
					spawned.error,
				),
			);
		}
		const child = spawned.value;
		child.onStderr((text) => {
			this.stderrTail = keepTail(this.stderrTail + text, ACP_STDERR_TAIL_BYTES);
		});
		child.onExit((exitCode, signal) => {
			const opened = this.opened;
			this.opened = null;
			if (this.closing) return;
			const reason = `The ${this.deps.adapter.displayName} agent stopped (exit ${exitCode ?? "none"}${signal === null ? "" : `, ${signal}`}).${this.stderrTail === "" ? "" : ` ${this.stderrTail}`}`;
			this.deps.logger.warn("The ACP agent process exited", {
				adapter: this.deps.adapter.id,
				exitCode,
				signal,
			});
			opened?.connection.close(new Error(reason));
			for (const listener of [...this.closeListeners]) listener(reason);
		});

		const stream = ndJsonStream(child.stdin, child.stdout);
		const app = createClientApp({ name: ACP_CLIENT_NAME });
		this.registerHandlers(app);
		const connection = app.connect(stream);
		this.opened = { connection, child };
		this.sessionId = null;
		this.configOptions = [];

		try {
			const response = await connection.agent.request<InitializeResponse>(
				ACP_AGENT_METHODS.initialize,
				{
					protocolVersion: 1,
					clientCapabilities: {
						fs: {
							readTextFile: true,
							writeTextFile: true,
						} satisfies FileSystemCapabilities,
						elicitation: { form: {} },
						session: { configOptions: { boolean: {} } },
					},
					clientInfo: {
						name: ACP_CLIENT_NAME,
						title: "Conducted",
						version: ACP_CLIENT_VERSION,
					},
				},
			);
			this.agentVersion = response.agentInfo?.version;
			this.agentCapabilities = response.agentCapabilities;
			this.authMethods = (response.authMethods ?? []).map((method) => method.name);
			return ok({ agentVersion: this.agentVersion });
		} catch (cause) {
			this.opened = null;
			connection.close();
			await child.stop(ACP_CLOSE_TIMEOUT_MS);
			return err(this.failure(cause));
		}
	}

	private registerHandlers(app: ReturnType<typeof createClientApp>): void {
		app.onNotification(ACP_CLIENT_METHODS.sessionUpdate, ({ params }) => {
			this.deps.handlers.onSessionUpdate(params);
		});
		app.onRequest(ACP_CLIENT_METHODS.sessionRequestPermission, async ({ params }) => {
			try {
				return await this.deps.handlers.requestPermission(params);
			} catch (cause) {
				this.deps.logger.warn("Could not ask the user about an ACP permission request", {
					adapter: this.deps.adapter.id,
					reason: failureText(cause),
				});
				return { outcome: { outcome: "cancelled" as const } };
			}
		});
		app.onRequest(ACP_CLIENT_METHODS.elicitationCreate, async ({ params }) => {
			if (params.mode !== "form") return { action: "decline" as const };
			try {
				return await this.deps.handlers.requestElicitation(params);
			} catch (cause) {
				this.deps.logger.warn("Could not ask the user for an ACP form", {
					adapter: this.deps.adapter.id,
					reason: failureText(cause),
				});
				return { action: "cancel" as const };
			}
		});
		app.onRequest(ACP_CLIENT_METHODS.fsReadTextFile, async ({ params }) => {
			const content = await this.readTextFile(params.path, params.line, params.limit);
			if (!content.ok) throw new Error(content.error.message);
			return { content: content.value };
		});
		app.onRequest(ACP_CLIENT_METHODS.fsWriteTextFile, async ({ params }) => {
			const written = await this.writeTextFile(params.path, params.content);
			if (!written.ok) throw new Error(written.error.message);
			return {};
		});
	}

	private async readTextFile(
		target: string,
		line: number | null | undefined,
		limit: number | null | undefined,
	): Promise<Result<string, AppError>> {
		const allowed = await this.allowedPath(target);
		if (!allowed.ok) return allowed;
		try {
			const info = await stat(allowed.value);
			const whole = await readFile(allowed.value, "utf8");
			const sliced = sliceLines(whole, line, limit);
			if (Buffer.byteLength(sliced, "utf8") <= ACP_FILE_READ_LIMIT_BYTES) return ok(sliced);
			const cut = Buffer.from(sliced, "utf8")
				.subarray(0, ACP_FILE_READ_LIMIT_BYTES)
				.toString("utf8");
			return ok(
				`${cut}\n\n…[the file is ${info.size} bytes; showing the first ${ACP_FILE_READ_LIMIT_BYTES} bytes]…`,
			);
		} catch (cause) {
			return err(
				appError("acp_file_read_failed", `Could not read ${target}: ${messageOf(cause)}`, cause),
			);
		}
	}

	private async writeTextFile(target: string, content: string): Promise<Result<void, AppError>> {
		const allowed = await this.allowedPath(target);
		if (!allowed.ok) return allowed;
		try {
			await this.deps.handlers.beforeWrite?.();
			await mkdir(dirname(allowed.value), { recursive: true });
			await writeFile(allowed.value, content, "utf8");
			return ok(undefined);
		} catch (cause) {
			return err(
				appError("acp_file_write_failed", `Could not write ${target}: ${messageOf(cause)}`, cause),
			);
		}
	}

	private async allowedPath(target: string): Promise<Result<string, AppError>> {
		if (!isAbsolute(target)) {
			return err(
				appError("acp_path_outside", `The ACP agent asked for a relative path: ${target}`),
			);
		}
		const real = await this.realTarget(target);
		const inside = this.allowedRoots.some(
			(root) => real === root || real.startsWith(`${root}/`) || real.startsWith(`${root}\\`),
		);
		return inside
			? ok(real)
			: err(
					appError(
						"acp_path_outside",
						`The ACP agent asked for a path outside the workspace: ${target}`,
					),
				);
	}

	private async realRoots(roots: readonly string[]): Promise<string[]> {
		const real = await Promise.all(
			roots.map(async (root) => {
				try {
					return await realpath(root);
				} catch {
					return resolve(root);
				}
			}),
		);
		return [...new Set(real)];
	}

	/**
	 * Resolves the deepest ancestor that exists, then appends the rest. A symlink in an existing
	 * ancestor is followed, so a write cannot escape the workspace through it.
	 */
	private async realTarget(target: string): Promise<string> {
		let existing = target;
		const rest: string[] = [];
		while (true) {
			try {
				const real = await realpath(existing);
				return rest.length === 0 ? real : join(real, ...rest.reverse());
			} catch (cause) {
				if (!isMissingFile(cause)) throw cause;
				const parent = dirname(existing);
				if (parent === existing) return resolve(target);
				rest.push(basename(existing));
				existing = parent;
			}
		}
	}

	private failure(cause: unknown): AppError {
		const described = describeAcpFailure(cause, {
			adapter: this.deps.adapter,
			authMethods: this.authMethods,
			stderrTail: this.stderrTail,
			lastOutput: this.deps.handlers.lastOutput?.(),
		});
		return appError(described.code, described.message, cause);
	}
}

/** Applies ACP's one-based line and limit to the file's text. */
export function sliceLines(
	text: string,
	line: number | null | undefined,
	limit: number | null | undefined,
): string {
	if ((line === null || line === undefined) && (limit === null || limit === undefined)) return text;
	const lines = text.split("\n");
	const start = line === null || line === undefined ? 0 : Math.max(0, line - 1);
	const end =
		limit === null || limit === undefined
			? lines.length
			: Math.max(start, start + Math.max(0, limit));
	return lines.slice(start, end).join("\n");
}

function keepTail(text: string, bytes: number): string {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.length <= bytes) return text;
	return buffer.subarray(buffer.length - bytes).toString("utf8");
}

type Settled = "done" | "timeout" | "failed";

/** Resolves at the timeout, and never rejects: a close must always finish. */
async function settleWithin(promise: Promise<unknown>, ms: number): Promise<Settled> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<Settled>((resolveTimeout) => {
		timer = setTimeout(() => resolveTimeout("timeout"), ms);
	});
	const settled = promise.then(
		() => "done" as const,
		() => "failed" as const,
	);
	try {
		return await Promise.race([settled, timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
