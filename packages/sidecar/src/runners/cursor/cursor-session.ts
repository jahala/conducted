/**
 * @feature AGENT-09 Cursor: SDK in process
 * Owns: one chat's Cursor agent and its current run, and implements AgentSession.
 * Behaviour: research/conductor/other-runners.md section 2.3: no child process of our own; the
 * agent id equals our session id (no separate id is stored); one run at a time ("A turn is already
 * in progress" otherwise); the run's stream is iterated and translated; steer calls run.steer and
 * a non-delivered outcome hands the message back as a follow-up; cancel sets a flag and calls
 * run.cancel; there are no permission callbacks, so Cursor runs with the SDK's own defaults.
 * Must handle:
 *  - resume: resumeAgent first; if it fails and the failure is not a sign-in problem, createAgent
 *    with the same id and log that history is gone
 *  - a missing or rejected API key: an error outcome with code agentAuthRequired and a message that
 *    points to Settings, never the key itself
 *  - cancel during the stream: the loop ends, the outcome is cancelled, late messages are dropped
 *  - steer on a run without steer(): SteerNotSupportedError; a non-delivered outcome:
 *    SteerRevertedError (the manager queues it)
 *  - text and thinking chunks are buffered and flushed as one message at a tool boundary or the end
 *    of the turn (translate.ts owns the buffer)
 *  - applyConfig: any model or effort change returns "restart" (a new agent with new options)
 *  - contextUsage: null (the SDK reports none)
 * Test first: with a fake SDK whose run streams one text message and finishes, runTurn emits one
 * text message and resolves success.
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
import type { LoadCursorSdk } from "./cursor-sdk.ts";
import type { EnvLock } from "./env-lock.ts";
import type { CursorTranslator } from "./translate.ts";

export interface CursorSessionDeps {
	loadSdk: LoadCursorSdk;
	envLock: EnvLock;
	translator: CursorTranslator;
	/** The API key for this chat, from the user's Settings or environment. Undefined if unset. */
	apiKey: string | undefined;
	logger: Logger;
}

export class CursorSession implements AgentSession {
	readonly sessionId: SessionId;

	constructor(
		protected readonly deps: CursorSessionDeps,
		protected readonly start: StartOptions,
	) {
		this.sessionId = start.sessionId;
	}

	runTurn(_input: TurnInput, _callbacks: TurnCallbacks): Promise<TurnOutcome> {
		return notImplemented("AGENT-09");
	}

	steer(_input: TurnInput): Promise<{ consumed: Promise<void> }> {
		return notImplemented("AGENT-09");
	}

	cancel(): Promise<void> {
		return notImplemented("AGENT-09");
	}

	applyConfig(_config: SessionConfig): Promise<"applied" | "restart"> {
		return notImplemented("AGENT-09");
	}

	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return notImplemented("AGENT-09");
	}

	dispose(): Promise<void> {
		return notImplemented("AGENT-09");
	}
}
