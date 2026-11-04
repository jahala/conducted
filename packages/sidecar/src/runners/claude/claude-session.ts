/**
 * @feature AGENT-02 Claude: Agent SDK in streaming-input mode, resume, fork
 * Owns: one chat's Claude process. It holds the SDK query object, the input queue that feeds it,
 * the translator, the turn tracker, the permission handler and the steer receipts, and implements
 * AgentSession on top of them.
 * Behaviour: research/conductor/claude-runner.md sections 1 to 3 and 6, sessions.md section 3
 * "Claude". One `claude` process lives for the whole chat. Each user message is pushed into the
 * same input stream (util/async-queue.ts). The query object yields SDK messages, which the
 * translator turns into AgentMessage values.
 * Must handle:
 *  - runTurn while another turn runs: refused with an error outcome (the manager prevents it)
 *  - steer(): pushes another user message with a fresh uuid, registers a receipt, and returns
 *    `consumed` that resolves when the mirror shows the agent read it; only while a turn is open,
 *    else NoActiveTurnError; the result that arrives before the steer is read is held back
 *  - cancel(): in-band interrupt first, wait INTERRUPT_GRACE_MS for the result, then stop the
 *    process (SIDE-04 takes the end checkpoint). Pending interactions are withdrawn by the manager
 *  - the process exits or the stream throws: the turn ends with an error outcome that carries the
 *    exit code and the stderr tail; the next runTurn starts a new process with resume
 *  - applyConfig(): live changes through setModel, applyFlagSettings and setPermissionMode;
 *    restart changes dispose and respawn with resume between turns (returns "restart")
 *  - fork or rewind: start with resumeSessionAt and forkSession; the new session id is reported
 *    through onAgentSessionId
 *  - the first SDK message with a session id reports it through onAgentSessionId
 *  - the "Fast mode requires extra usage billing" stderr line calls onFastModeUnavailable
 *  - the PreToolUse hook awaits beforeFirstWrite() once per turn for tools that can write
 *  - a late message from a cancelled turn must not reach the next turn's callbacks
 *  - dispose(): close the input queue, abort, wait for exit (SIGTERM, SIGKILL after 5 s by the SDK)
 *  - AskUserQuestion, tool approval and ExitPlanMode go through TurnCallbacks.requestInteraction
 * Test first: with a scripted query function that yields init, assistant text and a result for
 * the pushed uuid, runTurn emits the text message and resolves with success.
 * Our design choice: the SDK's query function is a constructor parameter (Conductor does this
 * too), so tests drive the session with a scripted stream and never start a real CLI.
 */
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import type {
	AgentSession,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runner.ts";

/** The SDK's query function, as a type. */
export type QueryFunction = (params: {
	prompt: AsyncIterable<SDKUserMessage>;
	options?: Options;
}) => Query;

export interface ClaudeSessionDeps {
	query: QueryFunction;
	executablePath: string;
	appTools: AppToolBackend;
	logger: Logger;
	/** Checks for a resumable transcript on disk. */
	hasTranscript(sessionId: SessionId, cwd: string): Promise<boolean>;
	/** Resolves symlinks for the edit-path check. Returns null when the path cannot be resolved. */
	realPath(path: string): Promise<string | null>;
	newUuid(): string;
}

export class ClaudeSession implements AgentSession {
	readonly sessionId: SessionId;

	constructor(
		protected readonly deps: ClaudeSessionDeps,
		protected readonly start: StartOptions,
	) {
		this.sessionId = start.sessionId;
	}

	/** Spawns the process (query() with an open input stream) so the first message starts fast. */
	warm(): Promise<void> {
		return notImplemented("AGENT-02");
	}

	runTurn(_input: TurnInput, _callbacks: TurnCallbacks): Promise<TurnOutcome> {
		return notImplemented("AGENT-02");
	}

	steer(_input: TurnInput): Promise<{ consumed: Promise<void> }> {
		return notImplemented("AGENT-05");
	}

	cancel(): Promise<void> {
		return notImplemented("AGENT-02");
	}

	applyConfig(_config: SessionConfig): Promise<"applied" | "restart"> {
		return notImplemented("AGENT-04");
	}

	contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return notImplemented("AGENT-02");
	}

	dispose(): Promise<void> {
		return notImplemented("AGENT-02");
	}
}
