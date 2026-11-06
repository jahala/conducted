/**
 * @feature AGENT-15 Turns the Claude program starts by itself
 * Owns: the host side of work an agent starts by itself: flipping the chat to working when it
 * starts and back to idle when it ends, and storing the messages of such a turn.
 * Behaviour: sessions.md 2 "Turn boundary detail" and "Status and state literals" (idle is
 * published only after the last event is sent). The runner side is
 * `runners/claude/self-started-turns.ts`.
 * Must handle: work that starts while a turn of ours runs (ignored: the turn owns the state); work
 * that starts on an idle chat (working, with no user message); the end (events flushed, then idle,
 * with the outcome the runner reports); a chat that was reset (a late report is dropped, by the run
 * guard); the process manager (`markBusy` and `markIdle` follow the live state); a message typed on
 * claude.ai that names this work after it ended (`turnIdOf` keeps the newest turn, RC-03).
 * A user message that arrives during such work belongs to the manager's queue (SIDE-03); this class
 * does not receive it or start anything from it. The session manager makes one per agent start and
 * hands its callbacks to the runner (`StartOptions.selfStartedTurns`); `onSettled` is the manager's
 * own end-of-turn step, which drains that queue.
 * Our design choice: the stored events of such a turn end with `turn_ended` like any turn (D008),
 * and have no `user_message` before them. A stream that ends without a result is `interrupted`; a
 * stream that throws is `error` with the message; only a real result is `success`.
 * Test first: `onInProgressChanged(id, true)` on an idle chat publishes working; `false` after the
 * flush publishes idle and a `turn_ended` with the reported outcome, and nothing is published for a
 * chat with a turn of ours open.
 */
import type { AgentMessage, SessionEvent } from "@conducted/protocol";
import type { Clock, EventId, IdSource, SessionId, TurnId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { ProcessManager } from "../process/process-manager.ts";
import type { EventPublisher } from "./event-batcher.ts";
import { beginTurn, endTurn, type LiveStateStore } from "./live-state.ts";
import type { RunGuard, RunNumber } from "./run-guard.ts";

interface ActiveTurn {
	readonly sessionId: SessionId;
	readonly turnId: TurnId;
	readonly run: RunNumber;
}

/** How a self-started turn ended, as the runner reports it. */
export type SelfStartedTurnEnd =
	| { readonly outcome: "success" }
	| { readonly outcome: "interrupted" }
	| { readonly outcome: "error"; readonly error: string };

export class SelfStartedTurns {
	private readonly active = new Map<SessionId, ActiveTurn>();
	/** The newest such turn of each chat, open or ended, for a message that names it late (RC-03). */
	private readonly latest = new Map<SessionId, TurnId>();

	constructor(
		protected readonly deps: {
			liveState: LiveStateStore;
			publisher: EventPublisher;
			processes: ProcessManager;
			runGuard: RunGuard;
			clock: Clock;
			ids: IdSource;
			logger: Logger;
			/** The key of this chat's process, for the busy and idle marks. */
			processKey: string;
			/** Called after idle is published, so the manager can start a queued message. */
			onSettled(run: RunNumber): void;
		},
	) {}

	/** The runner reports that the agent started (true) or stopped (false) working by itself. */
	async onInProgressChanged(
		sessionId: SessionId,
		inProgress: boolean,
		end?: SelfStartedTurnEnd,
	): Promise<void> {
		if (inProgress) {
			if (this.active.has(sessionId)) return;
			if (this.deps.liveState.get(sessionId).status === "working") return;
			this.start(sessionId);
			await this.markWorking(sessionId);
			return;
		}

		const turn = this.active.get(sessionId);
		if (turn === undefined) return;
		this.active.delete(sessionId);
		// A chat that was reset has a stale run number; its live state is already gone.
		if (!this.deps.runGuard.isCurrent(turn.run)) return;
		// A caller that omits the end has proved nothing about success, so do not claim it.
		await this.finish(turn, end ?? { outcome: "interrupted" });
	}

	/**
	 * The open self-started turn of a chat, else its newest one: a message typed on claude.ai is
	 * named by a frame of the turn it started, which may already have ended (RC-03).
	 */
	turnIdOf(sessionId: SessionId): TurnId | undefined {
		return this.active.get(sessionId)?.turnId ?? this.latest.get(sessionId);
	}

	/** One message of such a turn. */
	onMessage(sessionId: SessionId, message: AgentMessage): void {
		let turn = this.active.get(sessionId);
		if (turn === undefined) {
			if (this.deps.liveState.get(sessionId).status === "working") {
				this.deps.logger.debug("Dropped a message for work with no self-started turn", {
					sessionId,
				});
				return;
			}
			// A message can arrive before the runner's first state report. Open the turn here so
			// the agent's output is never lost.
			turn = this.start(sessionId);
			void this.markWorking(sessionId);
		}
		const event: SessionEvent = {
			type: "agent",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			turnId: turn.turnId,
			message,
		};
		this.deps.publisher.publish(sessionId, event);
	}

	private start(sessionId: SessionId): ActiveTurn {
		const run = this.deps.runGuard.start();
		const turn: ActiveTurn = {
			sessionId,
			turnId: this.deps.ids.uuid() as TurnId,
			run,
		};
		this.active.set(sessionId, turn);
		this.latest.set(sessionId, turn.turnId);
		return turn;
	}

	private async markWorking(sessionId: SessionId): Promise<void> {
		try {
			await this.deps.liveState.update(sessionId, beginTurn);
		} catch (cause) {
			this.deps.logger.warn("Could not mark work the agent started as working", {
				sessionId,
				reason: messageOf(cause),
			});
		}
		this.mark("markBusy", sessionId);
	}

	private async finish(turn: ActiveTurn, end: SelfStartedTurnEnd): Promise<void> {
		const event: SessionEvent = {
			type: "turn_ended",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			turnId: turn.turnId,
			outcome: end.outcome,
			...(end.outcome === "error" ? { error: end.error } : {}),
		};
		this.deps.publisher.publish(turn.sessionId, event);

		try {
			await this.deps.publisher.flush(turn.sessionId);
		} catch (cause) {
			this.deps.logger.warn("The self-started turn's last events could not be flushed", {
				sessionId: turn.sessionId,
				turnId: turn.turnId,
				reason: messageOf(cause),
			});
		}

		try {
			await this.deps.liveState.update(turn.sessionId, (live) =>
				endTurn(live, end.outcome === "error" ? end.error : undefined),
			);
		} catch (cause) {
			this.deps.logger.warn("Could not report the chat idle", {
				sessionId: turn.sessionId,
				reason: messageOf(cause),
			});
		}
		this.mark("markIdle", turn.sessionId);

		try {
			this.deps.onSettled(turn.run);
		} catch (cause) {
			this.deps.logger.warn("Could not start the next queued message", {
				sessionId: turn.sessionId,
				reason: messageOf(cause),
			});
		}
	}

	private mark(kind: "markBusy" | "markIdle", sessionId: SessionId): void {
		try {
			this.deps.processes[kind](this.deps.processKey);
		} catch (cause) {
			this.deps.logger.warn("Could not update the chat's process state", {
				sessionId,
				mark: kind,
				reason: messageOf(cause),
			});
		}
	}
}
