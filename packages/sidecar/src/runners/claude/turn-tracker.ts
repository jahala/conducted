/**
 * @feature AGENT-02 Claude: turn bookkeeping
 * Owns: deciding, for each SDK message, whether it ends the turn we are waiting for, and keeping
 * the turn from hanging.
 * Behaviour: research/conductor/claude-runner.md section 2 and sessions.md section 2 "Turn boundary
 * detail": every message we push gets a uuid; a result carries the uuid of the user message it
 * answers; a result for a uuid we did not push is "foreign" (the CLI ran a turn for a background
 * task) and does not end our turn; a result while pushed steers are still unread is held back;
 * a watchdog of 120 s ends the turn if an ignored result is not followed by another turn;
 * system/session_state_changed events tell when the CLI is busy.
 * Must handle:
 *  - a result whose uuid we pushed: ends the turn when no steer is unread
 *  - a foreign result: forwarded as usage, does not end the turn, arms the watchdog
 *  - a "mini result" from a background-task notification (num_turns 0): never a boundary
 *  - a result while steers are unread: held back, watchdog armed, the next result decides
 *  - the CLI reports running again: the watchdog is disarmed
 *  - a result with is_error: the turn ends; the translator reports the error item
 *  - the stream ends or throws before a result: the turn ends with an error outcome
 *  - cancel: the turn ends as cancelled whatever arrives afterwards (late results are dropped)
 *  - watchdog timers come from an injected scheduler, so tests never wait
 * Test first: a result with an unknown user_message_uuid does not settle the turn, and the
 * watchdog (fake scheduler, 120 000 ms) settles it.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { notImplemented } from "@conducted/shared";
import type { TurnOutcome } from "../runner.ts";
import type { SteerReceipts } from "./steer-receipts.ts";

export interface Scheduler {
	/** Calls `fn` after `ms`. Returns a function that cancels the call. */
	after(ms: number, fn: () => void): () => void;
}

export type TrackerDecision =
	| { action: "forward" }
	| { action: "forward_and_settle"; outcome: TurnOutcome }
	| { action: "hold_back" };

export class ClaudeTurnTracker {
	constructor(
		protected readonly deps: {
			receipts: SteerReceipts;
			scheduler: Scheduler;
			onSettle(outcome: TurnOutcome): void;
		},
	) {}

	/** Registers the uuid of a user message pushed to the CLI. */
	expectTurn(_userMessageUuid: string): void {
		notImplemented("AGENT-02");
	}

	/** Looks at one SDK message and says what to do with it. */
	onSdkMessage(_message: SDKMessage): TrackerDecision {
		return notImplemented("AGENT-02");
	}

	/** The stream ended or threw. Settles the turn if one is open. */
	onStreamEnded(_error?: Error): void {
		notImplemented("AGENT-02");
	}

	/** Cancel: settle as cancelled and ignore everything that arrives later. */
	cancel(): void {
		notImplemented("AGENT-02");
	}
}
