/**
 * @feature AGENT-09 Cursor: SDK in process
 * Owns: one chat's Cursor agent and its current run, and implements AgentSession.
 * Behaviour: research/conductor/other-runners.md section 2.3: no child process of our own; the
 * agent id equals our session id (no separate id is stored); one run at a time ("A turn is already
 * in progress" otherwise); the run's stream is iterated and translated, then awaited; steer calls
 * run.steer and a revert_to_followup outcome hands the message back as a follow-up; cancel sets a
 * flag and calls run.cancel; there are no permission callbacks, so Cursor runs with the SDK's own
 * defaults. The SDK is loaded at the first turn, and the workspace's platform is opened on the
 * chat's store folder (cursor-sdk.ts).
 * Must handle:
 *  - resume: resumeAgent first; if it fails and the failure is not a sign-in problem, createAgent
 *    with the same id and log that history is gone
 *  - the run's result: "error" ends the turn with the SDK's message, "cancelled" ends it cancelled;
 *    a failed run resolves, it does not throw
 *  - a missing or rejected API key: an error outcome whose message points to Settings, never the
 *    key itself
 *  - cancel during the start or the stream: the loop ends, the outcome is cancelled, late messages
 *    are dropped, and text buffered before the cancel is still emitted
 *  - every end of a turn (success, cancel, error) flushes the translator, so the next turn starts
 *    with no text and no call ids of the last one
 *  - steer on a run without steer(): SteerNotSupportedError; a non-delivered outcome:
 *    SteerRevertedError (the manager queues it)
 *  - text and thinking chunks are buffered and flushed as one message at a tool boundary or the end
 *    of the turn (translate.ts owns the buffer)
 *  - applyConfig: any model, effort or fast-mode change returns "restart" (a new agent with new
 *    options)
 *  - contextUsage: null (the SDK reports none)
 *  - dispose ends a live run, stops a turn that is still starting (a run that `send` hands back
 *    later is cancelled at once), refuses later turns, closes the agent and gives the app tools
 *    token back; a restart closes the agent it replaces
 *  - a sign-in failure: the SDK's own AuthenticationError (what @cursor/sdk throws for a 401), or,
 *    for a run result that carries only text, whole words and phrases ("401 Unauthorized",
 *    "invalid API key", "not signed in"), never a substring such as "auth" in "author"
 * Test first: with a fake SDK whose run streams one text message and finishes, runTurn emits one
 * text message and resolves success.
 */
import type { AgentMessage, SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { NoActiveTurnError, SteerNotSupportedError, SteerRevertedError } from "../errors.ts";
import type {
	AgentSession,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runner.ts";
import type {
	CursorAgent,
	CursorAgentOptions,
	CursorModelParam,
	CursorPlatform,
	CursorRun,
	CursorSdk,
	LoadCursorSdk,
} from "./cursor-sdk.ts";
import type { EnvLock } from "./env-lock.ts";
import type { CursorTranslator } from "./translate.ts";

/** The tag every Cursor runner and session log line carries. */
export const CURSOR_LOG_TAG = "CursorAgentRunner";

export interface CursorSessionDeps {
	loadSdk: LoadCursorSdk;
	envLock: EnvLock;
	translator: CursorTranslator;
	/** The API key for this chat: CURSOR_API_KEY of its start environment. Undefined if unset. */
	apiKey: string | undefined;
	/** The user's local Cursor MCP servers, read and validated by the runner, plus the app tools. */
	mcpServers: Record<string, unknown>;
	/** The folder of this workspace's Cursor run store: the platform's `stateRoot`. */
	storeDir: string;
	/** Runs once when the session is disposed: gives the chat's app tools token back. */
	onDispose(): void;
	logger: Logger;
}

interface ActiveRun {
	run: CursorRun;
	generation: number;
}

type AgentResult = { ok: true; agent: CursorAgent } | { ok: false; outcome: TurnOutcome };

/** Whole words and phrases that say the key was refused or the account is not signed in. */
const AUTH_PHRASES: readonly RegExp[] = [
	/\bunauthori[sz]ed\b/i,
	/\bunauthenticated\b/i,
	/\bauth(?:enticat(?:e|ed|ion)|ori[sz]ation)?\b/i,
	/\bapi[ _-]?key\b/i,
	/\bnot (?:signed|logged) in\b/i,
	/\b(?:sign|log)[ -]?in (?:required|expired|failed)\b/i,
	/^\s*40[13]\b/,
	/\b(?:status|status code|http|error)\s*:?\s*40[13]\b/i,
];

/** True when the agent refused the key or the account is not signed in. */
export function isCursorAuthError(error: unknown): boolean {
	const text = messageOf(error);
	return AUTH_PHRASES.some((phrase) => phrase.test(text));
}

function authOutcome(): TurnOutcome {
	return {
		kind: "error",
		message:
			"Cursor rejected the API key, or no Cursor API key is set. Add your Cursor API key in Settings.",
		retryable: false,
	};
}

/** The model parameters Cursor takes for one chat. */
export function cursorModelParams(config: SessionConfig): CursorModelParam[] {
	return [
		{ id: "fast", value: config.fastMode ? "true" : "false" },
		{ id: "effort", value: config.effort },
	];
}

export class CursorSession implements AgentSession {
	readonly sessionId: SessionId;

	private readonly log: Logger;
	private readonly agentId: string;
	private sdk: CursorSdk | null = null;
	private agent: CursorAgent | null = null;
	private active: ActiveRun | null = null;
	/** Set synchronously so two overlapping runTurn calls cannot both pass the guard. */
	private starting = false;
	private disposed = false;
	private generation = 0;
	/** The turn a cancel was asked for, so a start that has not reached send yet still stops. */
	private cancelledGeneration = 0;
	private config: SessionConfig;

	constructor(
		protected readonly deps: CursorSessionDeps,
		protected readonly start: StartOptions,
	) {
		this.sessionId = start.sessionId;
		this.agentId = start.resume?.agentSessionId ?? start.sessionId;
		this.config = start.config;
		this.log = deps.logger.child(CURSOR_LOG_TAG);
	}

	async runTurn(input: TurnInput, callbacks: TurnCallbacks): Promise<TurnOutcome> {
		if (this.disposed) {
			return { kind: "error", message: "This Cursor chat is closed.", retryable: false };
		}
		if (this.starting || this.active !== null) {
			return {
				kind: "error",
				message: "A turn is already in progress.",
				retryable: false,
			};
		}

		this.starting = true;
		const generation = ++this.generation;
		this.config = input.config;
		try {
			const ensured = await this.ensureAgent(input.config);
			if (!ensured.ok) return ensured.outcome;
			if (this.cancelledGeneration === generation) return { kind: "cancelled" };

			const sdk = ensured.agent;
			let run: CursorRun;
			try {
				run = await this.deps.envLock.withEnv(this.sdkEnv(), () => sdk.send(input.text));
			} catch (cause) {
				if (this.cancelledGeneration === generation) return { kind: "cancelled" };
				if (this.isAuthError(cause)) return authOutcome();
				return { kind: "error", message: messageOf(cause), retryable: false };
			}

			this.active = { run, generation };
			this.starting = false;
			this.log.debug("Cursor run started", { sessionId: this.sessionId });

			if (this.cancelledGeneration === generation) {
				await this.cancelRun(run);
				return { kind: "cancelled" };
			}

			try {
				for await (const message of run.stream()) {
					if (this.cancelledGeneration === generation) break;
					this.emit(this.deps.translator.push(message), callbacks);
				}
				if (this.cancelledGeneration === generation) return { kind: "cancelled" };
				const result = await run.wait();
				if (this.cancelledGeneration === generation) return { kind: "cancelled" };
				if (result.status === "cancelled") return { kind: "cancelled" };
				if (result.status === "error") {
					const failure = result.error ?? { message: "The Cursor run failed." };
					if (isCursorAuthError(failure.message)) return authOutcome();
					return { kind: "error", message: failure.message, retryable: false };
				}
				return { kind: "success" };
			} catch (cause) {
				if (this.cancelledGeneration === generation) return { kind: "cancelled" };
				if (this.isAuthError(cause)) return authOutcome();
				return { kind: "error", message: messageOf(cause), retryable: false };
			}
		} finally {
			// Every end of the turn emits what is still buffered and clears the translator's calls, so
			// partial text survives a cancel or a failure and the next turn starts clean.
			this.emit(this.deps.translator.flush(), callbacks);
			this.starting = false;
			this.active = null;
		}
	}

	async steer(input: TurnInput): Promise<{ consumed: Promise<void> }> {
		const active = this.active;
		if (this.disposed || active === null) throw new NoActiveTurnError();
		const run = active.run;
		const steer = run.steer;
		if (typeof steer !== "function") throw new SteerNotSupportedError("cursor");

		const generation = active.generation;
		const outcome = await this.deps.envLock.withEnv(this.sdkEnv(), () =>
			steer.call(run, input.text),
		);
		if (this.cancelledGeneration === generation) throw new NoActiveTurnError();
		if (outcome === "complete_delivered") {
			this.log.debug("Cursor steer delivered", { sessionId: this.sessionId });
			return { consumed: Promise.resolve() };
		}
		this.log.debug("Cursor handed a steer back as a follow-up", { sessionId: this.sessionId });
		throw new SteerRevertedError();
	}

	async cancel(): Promise<void> {
		this.cancelledGeneration = this.generation;
		const active = this.active;
		if (active === null) {
			this.log.debug("Cursor cancel requested before the run started", {
				sessionId: this.sessionId,
			});
			return;
		}
		this.log.debug("Cursor run cancel requested", { sessionId: this.sessionId });
		await this.cancelRun(active.run);
	}

	applyConfig(config: SessionConfig): Promise<"applied" | "restart"> {
		const changed =
			config.model !== this.config.model ||
			config.effort !== this.config.effort ||
			config.fastMode !== this.config.fastMode;
		if (!changed) return Promise.resolve("applied");
		this.config = config;
		// Cursor takes its model and parameters when the agent is created, so a change means a new
		// agent resumed under the same id.
		this.closeAgent();
		return Promise.resolve("restart");
	}

	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return Promise.resolve(null);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		// A turn still starting stops at its next check; a run its send hands back is cancelled.
		this.cancelledGeneration = this.generation;
		const active = this.active;
		if (active !== null) await this.cancelRun(active.run);
		this.closeAgent();
		this.deps.onDispose();
	}

	private async ensureAgent(config: SessionConfig): Promise<AgentResult> {
		if (this.agent !== null) return { ok: true, agent: this.agent };
		if (this.deps.apiKey === undefined || this.deps.apiKey === "") {
			return { ok: false, outcome: authOutcome() };
		}

		const loaded = await this.deps.loadSdk();
		if (!loaded.ok) {
			return {
				ok: false,
				outcome: {
					kind: "error",
					message: `Cursor is not available: ${loaded.error.message}`,
					retryable: false,
				},
			};
		}
		this.sdk = loaded.value;
		const options = this.agentOptions(config);
		return this.deps.envLock.withEnv(this.sdkEnv(), async () => {
			let platform: CursorPlatform;
			try {
				platform = await loaded.value.createPlatform({
					stateRoot: this.deps.storeDir,
					workspaceRef: this.start.workspace.workspacePath,
				});
			} catch (cause) {
				return {
					ok: false as const,
					outcome: {
						kind: "error",
						message: `Cursor could not open its run store: ${messageOf(cause)}`,
						retryable: false,
					},
				};
			}
			try {
				const agent = await platform.resumeAgent(this.agentId, options);
				this.agent = agent;
				return { ok: true as const, agent };
			} catch (cause) {
				if (this.isAuthError(cause)) return { ok: false as const, outcome: authOutcome() };
				this.log.warn("Cursor could not resume this chat; its history is gone", {
					sessionId: this.sessionId,
					reason: messageOf(cause),
				});
				try {
					const agent = await platform.createAgent({ ...options, agentId: this.agentId });
					this.agent = agent;
					return { ok: true as const, agent };
				} catch (created) {
					if (this.isAuthError(created)) {
						return { ok: false as const, outcome: authOutcome() };
					}
					return {
						ok: false as const,
						outcome: {
							kind: "error",
							message: messageOf(created),
							retryable: false,
						},
					};
				}
			}
		});
	}

	private agentOptions(config: SessionConfig): CursorAgentOptions {
		return {
			apiKey: this.deps.apiKey ?? "",
			model: { id: config.model, params: cursorModelParams(config) },
			local: { cwd: this.start.workspace.workspacePath },
			mcpServers: this.deps.mcpServers,
		};
	}

	/** The chat's environment and the SDK's native package variables, for every SDK call. */
	private sdkEnv(): Record<string, string> {
		return { ...this.start.env, ...(this.sdk?.env ?? {}) };
	}

	private isAuthError(cause: unknown): boolean {
		return this.sdk?.isAuthenticationError(cause) === true || isCursorAuthError(cause);
	}

	private closeAgent(): void {
		const agent = this.agent;
		this.agent = null;
		if (agent === null) return;
		try {
			agent.close();
		} catch (cause) {
			this.log.warn("Cursor could not close its agent cleanly", {
				sessionId: this.sessionId,
				reason: messageOf(cause),
			});
		}
	}

	private emit(messages: AgentMessage[], callbacks: TurnCallbacks): void {
		for (const message of messages) callbacks.onMessage(message);
	}

	private async cancelRun(run: CursorRun): Promise<void> {
		try {
			await run.cancel();
		} catch (cause) {
			this.log.warn("Cursor could not stop its run cleanly", {
				sessionId: this.sessionId,
				reason: messageOf(cause),
			});
		}
	}
}
