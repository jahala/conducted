/**
 * @feature AGENT-06 Codex: threads, steer, interrupt
 * Owns: one chat's Codex process (a CodexAppServerClient) and its thread, and implements
 * AgentSession on top.
 * Behaviour: research/conductor/other-runners.md sections 2.1 and 4: `thread/start` or
 * `thread/resume` once, then `turn/start` per user message; `turn/steer` with the expected turn id
 * while a turn runs; `turn/interrupt` plus a local abort for cancel (Codex gets a real in-band
 * interrupt); resume tries `thread/resume` and, if it fails for a reason other than an abort or
 * sign-in, starts a new thread with a log line; rate-limit retries up to 4 times with jittered
 * exponential backoff.
 * Must handle:
 *  - the app server exited between turns: start a new one and resume the thread
 *  - interrupt during startup (before a turn id exists): remember the stop and end the start
 *    (a stop-generation counter, as Conductor has)
 *  - turn/interrupt with a wrong turn id: retry once with the server's active turn id
 *  - steer without an active turn: NoActiveTurnError; the server rejects a steer whose
 *    expectedTurnId is stale: treated the same way
 *  - `consumed` for a steer resolves when the server accepts turn/steer (Codex has no separate
 *    receipt)
 *  - the turn ends with status interrupted: outcome cancelled; failed: error outcome with the
 *    turn error message, retryable only for rate-limit errors
 *  - the thread id is reported through onAgentSessionId as soon as thread/started arrives
 *  - applyConfig: model and effort are per-turn overrides (live); approval policy and sandbox are
 *    per-turn overrides too; additional directories or app-tool changes need a new thread
 *    config, so they return "restart"
 *  - the first message after resume does not repeat the workspace instruction (the manager decides)
 * Test first: with a fake client, runTurn sends thread/start then turn/start and resolves success
 * when turn/completed with status completed arrives.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { AppError, Result, SessionId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { asAppError } from "../../util/errors.ts";
import { NoActiveTurnError } from "../errors.ts";
import type {
	AgentSession,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runner.ts";
import type { CodexAppServerClient } from "./app-server-client.ts";
import {
	CODEX_CLIENT_METHODS,
	CODEX_SERVER_NOTIFICATIONS,
	type CodexThreadResumeParams,
	type CodexThreadStartParams,
	type CodexThreadTokenUsage,
	type CodexTurn,
	type CodexTurnInterruptParams,
	type CodexTurnStartParams,
	type CodexTurnStatus,
	type CodexTurnSteerParams,
	type CodexUserInput,
} from "./protocol.ts";
import type { CodexTranslator } from "./translate.ts";

/** Retries for rate-limit and overload errors. From the research. */
export const CODEX_RATE_LIMIT_RETRIES = 4;

/** The longest wait between rate-limit retries. */
export const CODEX_RETRY_BASE_MS = 500;

export interface CodexSessionDeps {
	/** Makes a connected client. Called again when the process died between turns. */
	connectClient(): Promise<CodexAppServerClient>;
	translator: CodexTranslator;
	logger: Logger;
	/** Random jitter between 0 and 1, so tests control the backoff. */
	random(): number;
	sleep(ms: number): Promise<void>;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

interface PendingTurn {
	id: string | null;
	generation: number;
	callbacks: TurnCallbacks;
	completion: Deferred<CodexTurn>;
	cancellation: Deferred<void>;
}

type ThreadResult = { ok: true; threadId: string } | { ok: false; outcome: TurnOutcome };

/** True when an agent error says the turn was aborted or the user cancelled it. */
export function isCodexAbortError(error: AppError): boolean {
	const text = `${error.code} ${error.message}`.toLowerCase();
	return text.includes("abort") || text.includes("cancel") || text.includes("interrupt");
}

/** True when an agent error says the user is not signed in. */
export function isCodexAuthError(error: AppError): boolean {
	const text = `${error.code} ${error.message}`.toLowerCase();
	return (
		text.includes("auth") ||
		text.includes("login") ||
		text.includes("sign in") ||
		text.includes("signed in") ||
		text.includes("sign-in") ||
		text.includes("unauthorized")
	);
}

/** True when the next attempt may succeed after a provider limit or overload. */
export function isCodexRateLimitError(message: string): boolean {
	return /rate.?limit|too many requests|overloaded|\b429\b|usage limit/i.test(message);
}

/** Turns Codex's provider text into a short message a person can act on. */
export function friendlyCodexError(message: string): string {
	if (/usage limit|quota|exceeded your current quota/i.test(message)) {
		return "Codex has reached its usage limit. Try again later, or pick another model.";
	}
	if (/shar(e|ing)|shared subscription|subscription.*(not|can't|cannot)/i.test(message)) {
		return "This Codex account cannot share its access. Sign in with your own account.";
	}
	if (isCodexRateLimitError(message)) {
		return "Codex is busy right now. Try again in a moment.";
	}
	return message;
}

export class CodexSession implements AgentSession {
	readonly sessionId: SessionId;

	private client: CodexAppServerClient | null = null;
	private threadId: string | null = null;
	private threadClient: CodexAppServerClient | null = null;
	private activeTurn: PendingTurn | null = null;
	private serverActiveTurnId: string | null = null;
	private stopGeneration = 0;
	private config: SessionConfig;
	private usage: CodexThreadTokenUsage | null = null;

	constructor(
		protected readonly deps: CodexSessionDeps,
		protected readonly start: StartOptions,
	) {
		this.sessionId = start.sessionId;
		this.config = start.config;
	}

	async runTurn(input: TurnInput, callbacks: TurnCallbacks): Promise<TurnOutcome> {
		if (this.activeTurn !== null) {
			return { kind: "error", message: "A Codex turn is already running.", retryable: false };
		}
		const generation = this.stopGeneration;
		this.config = input.config;

		const connected = await this.ensureClient();
		if (!connected.ok) {
			return {
				kind: "error",
				message: friendlyCodexError(connected.error.message),
				retryable: false,
			};
		}
		const client = connected.value;
		if (this.stopGeneration !== generation) return { kind: "cancelled" };

		const thread = await this.ensureThread(client, callbacks, generation);
		if (!thread.ok) return thread.outcome;
		if (this.stopGeneration !== generation) return { kind: "cancelled" };

		const pending: PendingTurn = {
			id: null,
			generation,
			callbacks,
			completion: createDeferred<CodexTurn>(),
			cancellation: createDeferred<void>(),
		};
		this.activeTurn = pending;
		this.serverActiveTurnId = null;

		try {
			const started = await this.requestWithRetries<{ turn?: CodexTurn; turnId?: unknown }>(
				client,
				CODEX_CLIENT_METHODS.turnStart,
				this.turnStartParams(thread.threadId, input),
			);
			if (!started.ok) {
				return {
					kind: "error",
					message: friendlyCodexError(started.error.message),
					retryable: isCodexRateLimitError(started.error.message),
				};
			}
			const startedId = readTurnId(started.value);
			if (startedId !== null) pending.id = startedId;

			if (this.stopGeneration !== generation) {
				if (startedId !== null) {
					await client.request(
						CODEX_CLIENT_METHODS.turnInterrupt,
						{ threadId: thread.threadId, turnId: startedId } satisfies CodexTurnInterruptParams,
						{ timeoutMs: 30_000 },
					);
				}
				return { kind: "cancelled" };
			}

			const result = await Promise.race([
				pending.completion.promise.then((turn) => ({ kind: "turn" as const, turn })),
				pending.cancellation.promise.then(() => ({ kind: "cancelled" as const })),
			]);
			if (result.kind === "cancelled") return { kind: "cancelled" };

			const turn = result.turn;
			if (turn.status === "completed") return { kind: "success" };
			if (turn.status === "interrupted") return { kind: "cancelled" };
			const message = turn.error?.message ?? "Codex could not finish the turn.";
			return {
				kind: "error",
				message: friendlyCodexError(message),
				retryable: isCodexRateLimitError(message),
			};
		} finally {
			if (this.activeTurn === pending) this.activeTurn = null;
		}
	}

	async steer(input: TurnInput): Promise<{ consumed: Promise<void> }> {
		const turn = this.activeTurn;
		const client = this.client;
		const threadId = this.threadId;
		if (turn === null || turn.id === null || client === null || threadId === null) {
			throw new NoActiveTurnError();
		}
		const params: CodexTurnSteerParams = {
			threadId,
			input: toUserInput(input),
			expectedTurnId: turn.id,
		};
		const steered = await client.request(CODEX_CLIENT_METHODS.turnSteer, params);
		if (!steered.ok) {
			if (isStaleTurnError(steered.error)) throw new NoActiveTurnError();
			throw new Error(friendlyCodexError(steered.error.message));
		}
		return { consumed: Promise.resolve() };
	}

	async cancel(): Promise<void> {
		const turn = this.activeTurn;
		this.stopGeneration += 1;
		if (turn === null) return;

		const client = this.client;
		const threadId = this.threadId;
		if (client !== null && threadId !== null && turn.id !== null) {
			const first = await client.request(
				CODEX_CLIENT_METHODS.turnInterrupt,
				{ threadId, turnId: turn.id } satisfies CodexTurnInterruptParams,
				{ timeoutMs: 30_000 },
			);
			if (!first.ok) {
				const serverId = this.serverActiveTurnId;
				if (serverId !== null && serverId !== turn.id) {
					const retried = await client.request(
						CODEX_CLIENT_METHODS.turnInterrupt,
						{ threadId, turnId: serverId } satisfies CodexTurnInterruptParams,
						{ timeoutMs: 30_000 },
					);
					if (!retried.ok) {
						this.deps.logger.warn("Codex refused the turn interrupt twice", {
							code: retried.error.code,
							reason: retried.error.message,
						});
					}
				} else {
					this.deps.logger.warn("Codex refused the turn interrupt", {
						code: first.error.code,
						reason: first.error.message,
					});
				}
			}
		}
		turn.cancellation.resolve();
	}

	async applyConfig(config: SessionConfig): Promise<"applied" | "restart"> {
		const restart =
			!sameStrings(this.config.additionalDirectories, config.additionalDirectories) ||
			JSON.stringify(this.config.appTools) !== JSON.stringify(config.appTools);
		this.config = config;
		return restart ? "restart" : "applied";
	}

	async contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		const usage = this.usage;
		if (usage === null) return null;
		const windowTokens = usage.modelContextWindow ?? 0;
		if (windowTokens <= 0) return null;
		return { usedTokens: usage.last.totalTokens, windowTokens };
	}

	async dispose(): Promise<void> {
		this.stopGeneration += 1;
		this.activeTurn?.cancellation.resolve();
		const client = this.client;
		this.client = null;
		this.threadClient = null;
		if (client !== null) await client.close();
	}

	private async ensureClient(): Promise<Result<CodexAppServerClient, AppError>> {
		if (this.client !== null) return { ok: true, value: this.client };
		try {
			const client = await this.deps.connectClient();
			this.client = client;
			this.attach(client);
			return { ok: true, value: client };
		} catch (cause) {
			return {
				ok: false,
				error: asAppError("codex_connect_failed", "Could not start Codex", cause),
			};
		}
	}

	private attach(client: CodexAppServerClient): void {
		client.onNotification(CODEX_SERVER_NOTIFICATIONS.threadStarted, (params) => {
			const threadId = readThreadId(params);
			if (threadId === null) return;
			this.threadId = threadId;
			this.threadClient = client;
			this.activeTurn?.callbacks.onAgentSessionId(threadId);
		});
		client.onNotification(CODEX_SERVER_NOTIFICATIONS.turnStarted, (params) => {
			const turnId = readTurnId(params);
			if (turnId === null) return;
			this.serverActiveTurnId = turnId;
			const turn = this.activeTurn;
			if (turn !== null && turn.id === null) turn.id = turnId;
		});
		client.onNotification(CODEX_SERVER_NOTIFICATIONS.turnCompleted, (params) => {
			const turn = readTurn(params);
			if (turn === null) return;
			const active = this.activeTurn;
			if (active === null) return;
			if (active.id !== null && turn.id !== "" && active.id !== turn.id) return;
			active.completion.resolve(turn);
		});
		client.onNotification(CODEX_SERVER_NOTIFICATIONS.tokenUsageUpdated, (params) => {
			const usage = readUsage(params);
			if (usage !== null) this.usage = usage;
			this.translateNotification(client, CODEX_SERVER_NOTIFICATIONS.tokenUsageUpdated, params);
		});
		client.onNotification(CODEX_SERVER_NOTIFICATIONS.threadCompacted, (params) => {
			this.translateNotification(client, CODEX_SERVER_NOTIFICATIONS.threadCompacted, params);
		});
		client.onNotification(CODEX_SERVER_NOTIFICATIONS.error, (params) => {
			this.translateNotification(client, CODEX_SERVER_NOTIFICATIONS.error, params);
		});
		client.onNotification(CODEX_SERVER_NOTIFICATIONS.itemStarted, (params) => {
			this.translateItem(client, "started", params);
		});
		client.onNotification(CODEX_SERVER_NOTIFICATIONS.itemCompleted, (params) => {
			this.translateItem(client, "completed", params);
		});
		client.onClose((reason) => {
			if (this.client === client) this.client = null;
			if (this.threadClient === client) this.threadClient = null;
			const active = this.activeTurn;
			if (active !== null) {
				active.completion.resolve({
					id: active.id ?? "",
					status: "failed",
					error: { message: reason },
				});
			}
		});
	}

	private translateItem(
		client: CodexAppServerClient,
		phase: "started" | "completed",
		params: unknown,
	): void {
		if (this.client !== client) return;
		const root = asRecord(params);
		if (root === null) return;
		const item = root.item;
		if (item === undefined) return;
		const threadId = readString(root, "threadId") ?? this.threadId ?? "";
		const callbacks = this.activeTurn?.callbacks;
		if (callbacks === undefined) return;
		for (const message of this.deps.translator.translateItem(phase, item, threadId)) {
			callbacks.onMessage(message);
		}
	}

	private translateNotification(
		client: CodexAppServerClient,
		method: string,
		params: unknown,
	): void {
		if (this.client !== client) return;
		const callbacks = this.activeTurn?.callbacks;
		if (callbacks === undefined) return;
		for (const message of this.deps.translator.translateNotification(method, params)) {
			callbacks.onMessage(message);
		}
	}

	private async ensureThread(
		client: CodexAppServerClient,
		callbacks: TurnCallbacks,
		generation: number,
	): Promise<ThreadResult> {
		if (this.threadId !== null && this.threadClient === client) {
			return { ok: true, threadId: this.threadId };
		}

		const resumeId = this.threadId ?? this.start.resume?.agentSessionId;
		if (resumeId !== undefined && resumeId !== "") {
			const resumed = await this.requestWithRetries<unknown>(
				client,
				CODEX_CLIENT_METHODS.threadResume,
				{ ...this.threadParams(), threadId: resumeId } satisfies CodexThreadResumeParams,
			);
			if (resumed.ok) {
				const threadId = readThreadId(resumed.value) ?? resumeId;
				this.threadId = threadId;
				this.threadClient = client;
				callbacks.onAgentSessionId(threadId);
				return { ok: true, threadId };
			}
			if (isCodexAuthError(resumed.error)) {
				return {
					ok: false,
					outcome: {
						kind: "error",
						message: friendlyCodexError(resumed.error.message),
						retryable: false,
					},
				};
			}
			if (this.stopGeneration !== generation || isCodexAbortError(resumed.error)) {
				return { ok: false, outcome: { kind: "cancelled" } };
			}
			this.deps.logger.warn("Codex could not resume the thread; starting a new one", {
				code: resumed.error.code,
				reason: resumed.error.message,
			});
		}

		const started = await this.requestWithRetries<unknown>(
			client,
			CODEX_CLIENT_METHODS.threadStart,
			this.threadParams(),
		);
		if (!started.ok) {
			return {
				ok: false,
				outcome: {
					kind: "error",
					message: friendlyCodexError(started.error.message),
					retryable: isCodexRateLimitError(started.error.message),
				},
			};
		}
		const threadId = readThreadId(started.value);
		if (threadId === null) {
			return {
				ok: false,
				outcome: {
					kind: "error",
					message: "Codex did not return a thread id.",
					retryable: false,
				},
			};
		}
		this.threadId = threadId;
		this.threadClient = client;
		callbacks.onAgentSessionId(threadId);
		return { ok: true, threadId };
	}

	private threadParams(): CodexThreadStartParams {
		const params: CodexThreadStartParams = {
			cwd: this.start.workspace.workspacePath,
			model: this.config.model === "" ? null : this.config.model,
		};
		if (this.config.codexApprovalPolicy !== undefined) {
			params.approvalPolicy = this.config.codexApprovalPolicy;
		}
		if (this.config.codexSandboxMode !== undefined) {
			params.sandbox = this.config.codexSandboxMode;
		}
		return params;
	}

	private turnStartParams(threadId: string, input: TurnInput): CodexTurnStartParams {
		const params: CodexTurnStartParams = {
			threadId,
			input: toUserInput(input),
			model: input.config.model === "" ? null : input.config.model,
			effort: input.config.effort,
		};
		if (input.config.codexApprovalPolicy !== undefined) {
			params.approvalPolicy = input.config.codexApprovalPolicy;
		}
		if (input.config.codexSandboxMode !== undefined) {
			params.sandbox = input.config.codexSandboxMode;
		}
		return params;
	}

	private async requestWithRetries<T>(
		client: CodexAppServerClient,
		method: string,
		params: unknown,
	): Promise<Result<T, AppError>> {
		let attempt = 0;
		for (;;) {
			const result = await client.request<T>(method, params);
			if (result.ok || !isCodexRateLimitError(result.error.message)) return result;
			if (attempt >= CODEX_RATE_LIMIT_RETRIES) return result;
			const waitMs = retryDelay(attempt, this.deps.random());
			this.deps.logger.warn("Codex asked us to slow down; retrying", {
				method,
				attempt: attempt + 1,
				waitMs,
			});
			await this.deps.sleep(waitMs);
			attempt += 1;
		}
	}
}

function retryDelay(attempt: number, random: number): number {
	const base = Math.min(CODEX_RETRY_BASE_MS * 2 ** attempt, 30_000);
	return Math.round(base + base * random);
}

function toUserInput(input: TurnInput): CodexUserInput[] {
	const items: CodexUserInput[] = [{ type: "text", text: input.text, text_elements: [] }];
	for (const path of input.attachmentPaths) {
		items.push({ type: "localImage", path });
	}
	return items;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const a = [...left].sort();
	const b = [...right].sort();
	return a.every((value, index) => value === b[index]);
}

function isStaleTurnError(error: AppError): boolean {
	const text = `${error.code} ${error.message}`.toLowerCase();
	return text.includes("expected") || text.includes("active turn") || text.includes("no turn");
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
	const field = value[key];
	return typeof field === "string" ? field : undefined;
}

function readThreadId(params: unknown): string | null {
	const root = asRecord(params);
	if (root === null) return null;
	const direct = readString(root, "threadId");
	if (direct !== undefined) return direct;
	const thread = asRecord(root.thread);
	return thread === null ? null : (readString(thread, "id") ?? null);
}

function readTurnId(params: unknown): string | null {
	const root = asRecord(params);
	if (root === null) return null;
	const direct = readString(root, "turnId");
	if (direct !== undefined) return direct;
	const turn = asRecord(root.turn);
	return turn === null ? null : (readString(turn, "id") ?? null);
}

function readTurn(params: unknown): CodexTurn | null {
	const root = asRecord(params);
	if (root === null) return null;
	const candidate = asRecord(root.turn) ?? root;
	const id = readString(candidate, "id") ?? readString(root, "turnId") ?? "";
	const status = candidate.status;
	if (!isTurnStatus(status)) return null;
	const errorRecord = asRecord(candidate.error);
	const message = errorRecord === null ? undefined : readString(errorRecord, "message");
	return {
		id,
		status,
		error: message === undefined ? null : { message },
	};
}

function isTurnStatus(value: unknown): value is CodexTurnStatus {
	return (
		value === "completed" || value === "interrupted" || value === "failed" || value === "inProgress"
	);
}

function numberField(value: Record<string, unknown> | null, key: string): number {
	if (value === null) return 0;
	const field = value[key];
	return typeof field === "number" ? field : 0;
}

function readUsage(params: unknown): CodexThreadTokenUsage | null {
	const root = asRecord(params);
	if (root === null) return null;
	const usage = asRecord(root.tokenUsage) ?? asRecord(root.usage) ?? root;
	const last = asRecord(usage.last) ?? usage;
	if (last === null) return null;
	const breakdown = {
		totalTokens: numberField(last, "totalTokens"),
		inputTokens: numberField(last, "inputTokens"),
		cachedInputTokens: numberField(last, "cachedInputTokens"),
		cacheWriteInputTokens: numberField(last, "cacheWriteInputTokens"),
		outputTokens: numberField(last, "outputTokens"),
		reasoningOutputTokens: numberField(last, "reasoningOutputTokens"),
	};
	const window = usage.modelContextWindow;
	return {
		total: breakdown,
		last: breakdown,
		modelContextWindow: typeof window === "number" ? window : null,
	};
}
