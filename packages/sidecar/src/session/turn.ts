/**
 * @feature SIDE-04 Turn lifecycle and stale-run guard
 * Owns: one turn from the user message to the idle report: the user_message event, the start
 * checkpoint, the runner call, the end checkpoint, the turn_ended event, the flush and the next
 * queued message.
 * Behaviour: research/conductor/sessions.md section 2 `kFe` (send a message), section 6 (cancel)
 * and section 7 (checkpoints), sessions-and-chats.md "What happens when you send a message".
 * Must handle:
 *  - sendMessage returns when the turn has started, not when it ends (runTurn is not awaited by
 *    the RPC); the promise is kept as the chat's in-flight chain
 *  - order: user_message event, wait for the previous turn's end checkpoint, start the checkpoint
 *    (not awaited by the runner start; the runner waits through beforeFirstWrite), runner.runTurn
 *  - the run number is checked before every state change after an await; a stale continuation
 *    does nothing
 *  - success, error and cancel each emit exactly one turn_ended event and one end checkpoint
 *  - the end checkpoint comes before the final flush, and idle is published after the flush
 *  - a runner that rejects (not a TurnOutcome): treated as an error outcome with its message
 *  - cancel during the start checkpoint: the checkpoint is allowed to finish, then the turn ends
 *  - after the turn: queued messages drain one at a time, a failed queued message is logged and
 *    the next one is tried
 *  - shutdown takes no checkpoint (sessions.md section 7)
 * Test first: with a runner that returns success, events appear in the order user_message,
 * checkpoint start, agent..., checkpoint end, turn_ended, and idle is published last.
 * Our design choice: an explicit turn_ended event (Conductor has none), so a turn cut off by a
 * crash can be found and closed at startup (DATA-03).
 */
import type { AgentMessage, SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { Clock, IdSource, MessageId, SessionId, TurnId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { CheckpointService } from "../checkpoints/checkpoint-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { AgentSession, TurnOutcome } from "../runners/runner.ts";
import type { EventPublisher } from "./event-batcher.ts";
import type { InteractionBroker } from "./interactions.ts";
import type { LiveStateStore } from "./live-state.ts";
import type { RunGuard, RunNumber } from "./run-guard.ts";

export interface TurnRequest {
	sessionId: SessionId;
	messageId: MessageId;
	turnId: TurnId;
	/** The text the user typed, as stored in the user_message event. */
	text: string;
	/** The assembled text sent to the agent (prompt/). */
	agentText: string;
	attachmentPaths: string[];
	config: SessionConfig;
	workspace: WorkspaceContext;
}

export interface TurnDeps {
	agent: AgentSession;
	runGuard: RunGuard;
	publisher: EventPublisher;
	liveState: LiveStateStore;
	interactions: InteractionBroker;
	checkpoints: CheckpointService;
	clock: Clock;
	ids: IdSource;
	logger: Logger;
	/** Stores the agent's own session id and tells the app. */
	onAgentSessionId(agentSessionId: string): void;
	/** Called after idle was published so the manager can start the next queued message. */
	onTurnSettled(run: RunNumber): void;
}

export class Turn {
	constructor(
		protected readonly deps: TurnDeps,
		readonly request: TurnRequest,
	) {}

	/** Starts the turn. Resolves when the runner has been called; the turn itself keeps running. */
	start(): Promise<RunNumber> {
		return notImplemented("SIDE-04");
	}

	/** Resolves when the turn has fully ended: events flushed and idle published. */
	settled(): Promise<TurnOutcome> {
		return notImplemented("SIDE-04");
	}

	/** Ends the turn after a cancel: runner cancel, end checkpoint, turn_ended, flush, idle. */
	cancel(): Promise<void> {
		return notImplemented("SIDE-04");
	}

	/** The message callback handed to the runner. Wraps the message into an agent event. */
	onMessage(_message: AgentMessage): void {
		notImplemented("SIDE-04");
	}
}
