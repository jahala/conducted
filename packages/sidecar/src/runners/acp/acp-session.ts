/**
 * @feature AGENT-11 ACP client and runner: the session
 * Owns: one chat's ACP agent: it opens the ACP session, runs prompts, consumes the update queue,
 * answers permission requests and implements AgentSession.
 * Behaviour: research/conductor/other-runners.md section 2.2 and 4: a per-session async queue of
 * typed events is consumed by a loop; runTurn sets the active turn (refused when one exists),
 * waits for pending config writes, reconciles model and config options, calls session/prompt
 * without awaiting it, and settles when the loop sees the end of the turn; steering is not
 * supported; cancel sends session/cancel, sets a flag and resolves every open permission and
 * question as cancelled; the ACP session id is stored as the agent session id; model changes
 * use session/set_config_option on the option with category "model".
 * Must handle:
 *  - steer(): SteerNotSupportedError("acp"); the manager queues the message
 *  - the stop reason decides the outcome (permission.ts outcomeFromStopReason)
 *  - permission requests: with approvals off answer allow_once at once; with approvals on open a
 *    tool_approval interaction after showing the tool call; a question-like request opens a
 *    question interaction whose labels are the option names
 *  - config changes while a turn runs are deferred to the next turn (applyConfig returns
 *    "restart" only when the adapter must be restarted; model and options are live between turns)
 *  - OpenCode: after session/new wait up to adapter.waitForModelCatalogMs for the model option
 *    before the first prompt, else the first prompt may use the wrong model
 *  - the first prompt of a resumed session whose resume fell back to a new session is flagged to the
 *    user with a notice item ("history was not restored")
 *  - the child dies mid-turn: error outcome with the stderr tail; the next turn starts a new child
 *  - contextUsage from the last usage_update
 * Test first: with an in-memory client, runTurn buffers two text chunks, then a stop reason of
 * end_turn flushes one text message and resolves success.
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
import type { AcpClient } from "./acp-client.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";
import type { AcpTranslator } from "./translate.ts";

export interface AcpSessionDeps {
	adapter: AcpAdapter;
	/** Makes a connected client. Called again when the child died between turns. */
	connectClient(): Promise<AcpClient>;
	translator: AcpTranslator;
	logger: Logger;
}

export class AcpSession implements AgentSession {
	readonly sessionId: SessionId;

	constructor(
		protected readonly deps: AcpSessionDeps,
		protected readonly start: StartOptions,
	) {
		this.sessionId = start.sessionId;
	}

	runTurn(_input: TurnInput, _callbacks: TurnCallbacks): Promise<TurnOutcome> {
		return notImplemented("AGENT-11");
	}

	steer(_input: TurnInput): Promise<{ consumed: Promise<void> }> {
		return notImplemented("AGENT-11");
	}

	cancel(): Promise<void> {
		return notImplemented("AGENT-11");
	}

	applyConfig(_config: SessionConfig): Promise<"applied" | "restart"> {
		return notImplemented("AGENT-11");
	}

	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return notImplemented("AGENT-11");
	}

	dispose(): Promise<void> {
		return notImplemented("AGENT-11");
	}
}
