/**
 * @feature AGENT-15 Turns the Claude program starts by itself
 * Owns: the host side of work an agent starts by itself: flipping the chat to working when it
 * starts and back to idle when it ends, and storing the messages of such a turn.
 * Behaviour: sessions.md 2 "Turn boundary detail" and "Status and state literals" (idle is
 * published only after the last event is sent). The runner side is
 * `runners/claude/self-started-turns.ts`.
 * Must handle: work that starts while a turn of ours runs (ignored: the turn owns the state); work
 * that starts on an idle chat (working, with no user message); the end (events flushed, then idle,
 * as in `turn.ts`); a user message that arrives during such work (it queues or steers like any
 * message to a working chat); a chat that was reset (a late report is dropped, by the run
 * guard); the process manager (`markBusy` and `markIdle` follow the live state).
 * Our design choice: the stored events of such a turn end with `turn_ended` like any turn (D008),
 * and have no `user_message` before them.
 * Test first: `onInProgressChanged(id, true)` on an idle chat publishes working; `false` after the
 * flush publishes idle, and nothing is published for a chat with a turn of ours open.
 */
import type { AgentMessage } from "@conducted/protocol";
import type { Clock, IdSource, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { ProcessManager } from "../process/process-manager.ts";
import type { EventPublisher } from "./event-batcher.ts";
import type { LiveStateStore } from "./live-state.ts";
import type { RunGuard } from "./run-guard.ts";

export class SelfStartedTurns {
	constructor(
		protected readonly deps: {
			liveState: LiveStateStore;
			publisher: EventPublisher;
			processes: ProcessManager;
			runGuard: RunGuard;
			clock: Clock;
			ids: IdSource;
			logger: Logger;
		},
	) {}

	/** The runner reports that the agent started (true) or stopped (false) working by itself. */
	onInProgressChanged(_sessionId: SessionId, _inProgress: boolean): Promise<void> {
		return notImplemented("AGENT-15");
	}

	/** One message of such a turn. */
	onMessage(_sessionId: SessionId, _message: AgentMessage): void {
		notImplemented("AGENT-15");
	}
}
