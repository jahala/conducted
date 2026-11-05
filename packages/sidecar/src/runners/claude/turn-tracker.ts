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
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnOutcome } from "../runner.ts";
import { SETTLEMENT_WATCHDOG_MS } from "./constants.ts";
import type { SteerReceipts } from "./steer-receipts.ts";

export interface Scheduler {
	/** Calls `fn` after `ms`. Returns a function that cancels the call. */
	after(ms: number, fn: () => void): () => void;
}

export type TrackerDecision =
	| { action: "forward" }
	| { action: "forward_and_settle"; outcome: TurnOutcome }
	| { action: "hold_back" };

/** How many settled uuids are remembered so a late duplicate result is dropped. */
const STALE_UUID_LIMIT = 1000;

export class ClaudeTurnTracker {
	/** Uuids pushed for the open turn. Their result belongs to us. */
	private readonly awaited = new Set<string>();
	/** Uuids of turns that already ended. A result for one of them is late. */
	private readonly stale = new Set<string>();
	private readonly staleOrder: string[] = [];
	private open = false;
	private settled = false;
	private cancelled = false;
	private disarmWatchdog: (() => void) | null = null;

	constructor(
		protected readonly deps: {
			receipts: SteerReceipts;
			scheduler: Scheduler;
			onSettle(outcome: TurnOutcome): void;
		},
	) {}

	/** Registers the uuid of a user message pushed to the CLI. */
	expectTurn(userMessageUuid: string): void {
		this.awaited.add(userMessageUuid);
		this.open = true;
		this.settled = false;
		this.cancelled = false;
		this.disarm();
	}

	/** Looks at one SDK message and says what to do with it. */
	onSdkMessage(message: SDKMessage): TrackerDecision {
		if (message.type === "system" && message.subtype === "session_state_changed") {
			// The CLI is working again, so an earlier ignored result no longer needs the guard.
			if (message.state === "running") this.disarm();
			return { action: "forward" };
		}
		if (message.type !== "result") return { action: "forward" };

		const uuids = resultUuids(message);
		if (uuids.some((uuid) => this.stale.has(uuid))) return { action: "hold_back" };
		if (!this.open) return { action: "forward" };
		// A background-task notification ends no turn.
		if (message.num_turns === 0) return { action: "forward" };
		if (!uuids.some((uuid) => this.awaited.has(uuid))) {
			// A foreign result, for example a turn the CLI ran for a background task.
			this.armWatchdog();
			return { action: "forward" };
		}
		if (this.deps.receipts.hasPending()) {
			// A steer was pushed but the agent has not read it yet, so this result is not the end.
			this.armWatchdog();
			return { action: "hold_back" };
		}
		const outcome: TurnOutcome = { kind: "success" };
		this.finish(outcome);
		return { action: "forward_and_settle", outcome };
	}

	/** The stream ended or threw. Settles the turn if one is open. */
	onStreamEnded(error?: Error): void {
		if (!this.open || this.settled) return;
		if (this.cancelled) {
			this.finish({ kind: "cancelled" });
			return;
		}
		this.finish({
			kind: "error",
			message: error?.message ?? "The Claude session ended unexpectedly.",
			retryable: false,
		});
	}

	/** Cancel: settle as cancelled and ignore everything that arrives later. */
	cancel(): void {
		this.cancelled = true;
		if (this.open && !this.settled) this.finish({ kind: "cancelled" });
	}

	private finish(outcome: TurnOutcome): void {
		if (this.settled) return;
		this.settled = true;
		this.open = false;
		this.disarm();
		for (const uuid of this.awaited) this.markStale(uuid);
		this.awaited.clear();
		this.deps.receipts.clear();
		this.deps.onSettle(outcome);
	}

	private markStale(uuid: string): void {
		if (this.stale.has(uuid)) return;
		this.stale.add(uuid);
		this.staleOrder.push(uuid);
		const oldest = this.staleOrder.length > STALE_UUID_LIMIT ? this.staleOrder.shift() : undefined;
		if (oldest !== undefined) this.stale.delete(oldest);
	}

	private armWatchdog(): void {
		this.disarm();
		this.disarmWatchdog = this.deps.scheduler.after(SETTLEMENT_WATCHDOG_MS, () => {
			this.disarmWatchdog = null;
			if (!this.open || this.settled) return;
			this.finish({ kind: "success" });
		});
	}

	private disarm(): void {
		const cancel = this.disarmWatchdog;
		if (cancel === null) return;
		this.disarmWatchdog = null;
		cancel();
	}
}

/** Every uuid a result says it answered. Older CLIs send only the last one. */
function resultUuids(message: SDKResultMessage): string[] {
	const uuids: string[] = [];
	if (Array.isArray(message.user_message_uuids)) {
		for (const uuid of message.user_message_uuids) {
			if (typeof uuid === "string" && uuid !== "") uuids.push(uuid);
		}
	}
	if (typeof message.user_message_uuid === "string" && message.user_message_uuid !== "") {
		uuids.push(message.user_message_uuid);
	}
	return uuids;
}
