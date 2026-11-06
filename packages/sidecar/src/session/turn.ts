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
import type {
	AgentMessage,
	Interaction,
	InteractionAnswer,
	LiveState,
	SessionConfig,
	SessionEvent,
	WorkspaceContext,
} from "@conducted/protocol";
import type { Clock, EventId, IdSource, MessageId, SessionId, TurnId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import type {
	CheckpointOutcome,
	CheckpointRequest,
	CheckpointService,
} from "../checkpoints/checkpoint-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { AgentSession, TurnCallbacks, TurnOutcome } from "../runners/runner.ts";
import type { EventPublisher } from "./event-batcher.ts";
import type { InteractionBroker } from "./interactions.ts";
import {
	beginTurn,
	endTurn,
	type LiveStateStore,
	markFastModeUnavailable,
	setBackgroundTasks,
	setWaitingSince,
} from "./live-state.ts";
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
	/** The agent reported its background work: true while any task is open. */
	onBackgroundTasks(hasTasks: boolean): void;
}

interface PostTurn {
	outcome: "success" | "error" | "cancelled";
	error?: string;
}

function postTurn(outcome: TurnOutcome): PostTurn {
	switch (outcome.kind) {
		case "success":
			return { outcome: "success" };
		case "error":
			return { outcome: "error", error: outcome.message };
		case "cancelled":
			return { outcome: "cancelled" };
	}
}

function liveError(outcome: TurnOutcome): string | undefined {
	switch (outcome.kind) {
		case "success":
			return undefined;
		case "error":
			return outcome.message;
		case "cancelled":
			return "aborted by user";
	}
}

export class Turn {
	private run: RunNumber | null = null;
	private startCheckpoint: Promise<void> | null = null;
	private finishPromise: Promise<TurnOutcome> | null = null;
	private cancelling = false;
	private settledFlag = false;
	private readonly settledPromise: Promise<TurnOutcome>;
	private resolveSettled!: (outcome: TurnOutcome) => void;

	constructor(
		protected readonly deps: TurnDeps,
		readonly request: TurnRequest,
	) {
		this.settledPromise = new Promise<TurnOutcome>((resolve) => {
			this.resolveSettled = resolve;
		});
	}

	/** Starts the turn. Resolves when the runner has been called; the turn itself keeps running. */
	start(): Promise<RunNumber> {
		if (this.run !== null) return Promise.resolve(this.run);
		const run = this.deps.runGuard.start();
		this.run = run;
		this.publishUserMessage();
		const working = this.markWorking();
		this.startCheckpoint = this.beginStartCheckpoint(run, working);
		return this.launch(run, working);
	}

	/** Resolves when the turn has fully ended: events flushed and idle published. */
	settled(): Promise<TurnOutcome> {
		return this.settledPromise;
	}

	/** Ends the turn after a cancel: runner cancel, end checkpoint, turn_ended, flush, idle. */
	async cancel(): Promise<void> {
		if (this.finishPromise !== null) {
			await this.finishPromise;
			return;
		}
		this.cancelling = true;
		if (this.run !== null) this.deps.runGuard.invalidate();
		try {
			await this.deps.agent.cancel();
		} catch (cause) {
			this.deps.logger.warn("The agent could not be stopped cleanly", {
				sessionId: this.request.sessionId,
				turnId: this.request.turnId,
				reason: messageOf(cause),
			});
		}
		await this.finish({ kind: "cancelled" });
	}

	/** The message callback handed to the runner. Wraps the message into an agent event. */
	onMessage(message: AgentMessage): void {
		if (!this.isCurrent()) return;
		const event: SessionEvent = {
			type: "agent",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			turnId: this.request.turnId,
			message,
		};
		this.deps.publisher.publish(this.request.sessionId, event);
	}

	private isCurrent(): boolean {
		return this.run !== null && this.deps.runGuard.isCurrent(this.run);
	}

	private async markWorking(): Promise<void> {
		try {
			await this.deps.liveState.update(this.request.sessionId, beginTurn);
		} catch (cause) {
			this.deps.logger.warn("Could not mark the chat as working", {
				sessionId: this.request.sessionId,
				reason: messageOf(cause),
			});
		}
	}

	private async beginStartCheckpoint(run: RunNumber, working: Promise<void>): Promise<void> {
		await working;
		if (!this.cancelling && !this.deps.runGuard.isCurrent(run)) return;
		await this.takeCheckpoint("start");
	}

	private async launch(run: RunNumber, working: Promise<void>): Promise<RunNumber> {
		await working;
		if (this.cancelling) return run;
		if (!this.deps.runGuard.isCurrent(run)) {
			this.settle({ kind: "cancelled" });
			return run;
		}
		const callbacks = this.callbacks(run);
		void this.runAgent(run, callbacks);
		return run;
	}

	private async runAgent(run: RunNumber, callbacks: TurnCallbacks): Promise<void> {
		let outcome: TurnOutcome;
		try {
			outcome = await this.deps.agent.runTurn(
				{
					text: this.request.agentText,
					attachmentPaths: this.request.attachmentPaths,
					config: this.request.config,
				},
				callbacks,
			);
		} catch (cause) {
			outcome = { kind: "error", message: messageOf(cause), retryable: false };
		}

		if (!this.deps.runGuard.isCurrent(run)) {
			if (!this.cancelling) this.settle({ kind: "cancelled" });
			return;
		}
		await this.finish(outcome);
	}

	private finish(outcome: TurnOutcome): Promise<TurnOutcome> {
		if (this.finishPromise !== null) return this.finishPromise;
		this.finishPromise = this.finalize(outcome);
		return this.finishPromise;
	}

	private async finalize(outcome: TurnOutcome): Promise<TurnOutcome> {
		if (this.startCheckpoint !== null) await this.startCheckpoint;
		await this.takeCheckpoint("end");
		this.publishTurnEnded(outcome);

		try {
			await this.deps.publisher.flush(this.request.sessionId);
		} catch (cause) {
			this.deps.logger.warn("The turn's last events could not be flushed", {
				sessionId: this.request.sessionId,
				turnId: this.request.turnId,
				reason: messageOf(cause),
			});
		}

		try {
			await this.deps.liveState.update(this.request.sessionId, (live) =>
				endTurn(live, liveError(outcome)),
			);
		} catch (cause) {
			this.deps.logger.warn("Could not report the chat idle", {
				sessionId: this.request.sessionId,
				reason: messageOf(cause),
			});
		}

		this.settle(outcome);
		if (this.run !== null) {
			try {
				this.deps.onTurnSettled(this.run);
			} catch (cause) {
				this.deps.logger.warn("Could not start the next queued message", {
					sessionId: this.request.sessionId,
					reason: messageOf(cause),
				});
			}
		}
		return outcome;
	}

	private settle(outcome: TurnOutcome): void {
		if (this.settledFlag) return;
		this.settledFlag = true;
		this.resolveSettled(outcome);
	}

	private callbacks(run: RunNumber): TurnCallbacks {
		return {
			onMessage: (message) => this.onMessage(message),
			requestInteraction: (interaction, signal) => this.openInteraction(interaction, signal),
			onAgentSessionId: (agentSessionId) => this.deps.onAgentSessionId(agentSessionId),
			onBackgroundTasks: (tasks, waitingSince) => {
				if (!this.deps.runGuard.isCurrent(run)) return;
				this.deps.onBackgroundTasks(tasks.length > 0);
				void this.updateLive((live) =>
					setWaitingSince(setBackgroundTasks(live, tasks), waitingSince),
				);
			},
			beforeFirstWrite: () => this.startCheckpoint ?? Promise.resolve(),
			onFastModeUnavailable: () => {
				if (!this.deps.runGuard.isCurrent(run)) return;
				void this.updateLive(markFastModeUnavailable);
			},
		};
	}

	private openInteraction(
		interaction: Interaction,
		signal?: AbortSignal,
	): Promise<InteractionAnswer> {
		if (!this.isCurrent()) return Promise.resolve({ kind: "withdrawn" });
		return this.deps.interactions.open(this.request.sessionId, interaction, signal);
	}

	private async updateLive(reducer: (state: LiveState) => LiveState): Promise<void> {
		try {
			await this.deps.liveState.update(this.request.sessionId, reducer);
		} catch (cause) {
			this.deps.logger.warn("Could not update the chat's live state", {
				sessionId: this.request.sessionId,
				reason: messageOf(cause),
			});
		}
	}

	private async takeCheckpoint(phase: "start" | "end"): Promise<void> {
		const request: CheckpointRequest = {
			sessionId: this.request.sessionId,
			turnId: this.request.turnId,
			workspacePath: this.request.workspace.workspacePath,
		};
		let outcome: CheckpointOutcome;
		try {
			outcome =
				phase === "start"
					? await this.deps.checkpoints.start(request)
					: await this.deps.checkpoints.end(request);
		} catch (cause) {
			this.deps.logger.warn("A turn checkpoint failed", {
				sessionId: this.request.sessionId,
				turnId: this.request.turnId,
				phase,
				reason: messageOf(cause),
			});
			outcome = { skippedReason: "failed" };
		}
		this.publishCheckpoint(phase, outcome);
	}

	private publishUserMessage(): void {
		const event: SessionEvent = {
			type: "user_message",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			messageId: this.request.messageId,
			turnId: this.request.turnId,
			text: this.request.text,
			attachmentPaths: this.request.attachmentPaths,
			delivery: "new_turn",
			config: this.request.config,
		};
		this.deps.publisher.publish(this.request.sessionId, event);
	}

	private publishCheckpoint(phase: "start" | "end", outcome: CheckpointOutcome): void {
		const event: SessionEvent = {
			type: "checkpoint",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			turnId: this.request.turnId,
			phase,
			...(outcome.checkpointId === undefined ? {} : { checkpointId: outcome.checkpointId }),
			...(outcome.skippedReason === undefined ? {} : { skippedReason: outcome.skippedReason }),
			...(outcome.changes === undefined ? {} : { changes: outcome.changes }),
		};
		this.deps.publisher.publish(this.request.sessionId, event);
	}

	private publishTurnEnded(outcome: TurnOutcome): void {
		const ended = postTurn(outcome);
		const event: SessionEvent = {
			type: "turn_ended",
			eventId: this.deps.ids.uuid() as EventId,
			at: this.deps.clock.now(),
			turnId: this.request.turnId,
			outcome: ended.outcome,
			...(ended.error === undefined ? {} : { error: ended.error }),
		};
		this.deps.publisher.publish(this.request.sessionId, event);
	}
}
