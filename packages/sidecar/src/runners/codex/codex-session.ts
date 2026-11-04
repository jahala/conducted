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
import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type {
	AgentSession,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runner.ts";
import type { CodexAppServerClient } from "./app-server-client.ts";
import type { CodexTranslator } from "./translate.ts";

/** Retries for rate-limit and overload errors. From the research. */
export const CODEX_RATE_LIMIT_RETRIES = 4;

export interface CodexSessionDeps {
	/** Makes a connected client. Called again when the process died between turns. */
	connectClient(): Promise<CodexAppServerClient>;
	translator: CodexTranslator;
	logger: Logger;
	/** Random jitter between 0 and 1, so tests control the backoff. */
	random(): number;
	sleep(ms: number): Promise<void>;
}

export class CodexSession implements AgentSession {
	readonly sessionId: SessionId;

	constructor(
		protected readonly deps: CodexSessionDeps,
		protected readonly start: StartOptions,
	) {
		this.sessionId = start.sessionId;
	}

	runTurn(_input: TurnInput, _callbacks: TurnCallbacks): Promise<TurnOutcome> {
		return notImplemented("AGENT-06");
	}

	steer(_input: TurnInput): Promise<{ consumed: Promise<void> }> {
		return notImplemented("AGENT-06");
	}

	cancel(): Promise<void> {
		return notImplemented("AGENT-06");
	}

	applyConfig(_config: SessionConfig): Promise<"applied" | "restart"> {
		return notImplemented("AGENT-06");
	}

	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return notImplemented("AGENT-06");
	}

	dispose(): Promise<void> {
		return notImplemented("AGENT-06");
	}
}
