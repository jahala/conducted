import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TurnOutcome } from "../runner.ts";
import { SETTLEMENT_WATCHDOG_MS } from "./constants.ts";
import { SteerReceipts } from "./steer-receipts.ts";
import { ClaudeTurnTracker, type Scheduler } from "./turn-tracker.ts";

interface FakeScheduler extends Scheduler {
	pending(): number;
	fire(ms: number): void;
}

function fakeScheduler(): FakeScheduler {
	const tasks: { ms: number; fn: () => void; cancelled: boolean }[] = [];
	return {
		after(ms, fn) {
			const task = { ms, fn, cancelled: false };
			tasks.push(task);
			return () => {
				task.cancelled = true;
			};
		},
		pending() {
			return tasks.filter((task) => !task.cancelled).length;
		},
		fire(ms) {
			for (const task of tasks) {
				if (task.cancelled || task.ms !== ms) continue;
				task.cancelled = true;
				task.fn();
			}
		},
	};
}

function resultMessage(options: {
	uuid?: string;
	uuids?: string[];
	numTurns?: number;
	isError?: boolean;
}): SDKMessage {
	return {
		type: "result",
		subtype: "success",
		is_error: options.isError ?? false,
		num_turns: options.numTurns ?? 1,
		user_message_uuid: options.uuid,
		user_message_uuids: options.uuids,
		duration_ms: 1,
		duration_api_ms: 1,
		stop_reason: "end_turn",
		total_cost_usd: 0.1,
		usage: {},
		modelUsage: {},
		permission_denials: [],
		errors: [],
		result: "",
		uuid: "result-uuid",
		session_id: "s1",
	} as unknown as SDKMessage;
}

function stateMessage(state: "idle" | "running" | "requires_action"): SDKMessage {
	return {
		type: "system",
		subtype: "session_state_changed",
		state,
		uuid: "state-uuid",
		session_id: "s1",
	} as unknown as SDKMessage;
}

function makeTracker(): {
	tracker: ClaudeTurnTracker;
	receipts: SteerReceipts;
	scheduler: FakeScheduler;
	outcomes: TurnOutcome[];
} {
	const receipts = new SteerReceipts();
	const scheduler = fakeScheduler();
	const outcomes: TurnOutcome[] = [];
	const tracker = new ClaudeTurnTracker({
		receipts,
		scheduler,
		onSettle: (outcome) => outcomes.push(outcome),
	});
	return { tracker, receipts, scheduler, outcomes };
}

describe("AGENT-02 turn tracker", () => {
	test("a result for an unknown user message does not settle, and the watchdog settles it", () => {
		const { tracker, scheduler, outcomes } = makeTracker();
		tracker.expectTurn("ours");

		expect(tracker.onSdkMessage(resultMessage({ uuid: "foreign" })).action).toBe("forward");
		expect(outcomes).toEqual([]);
		expect(scheduler.pending()).toBe(1);

		scheduler.fire(SETTLEMENT_WATCHDOG_MS);
		expect(outcomes).toEqual([{ kind: "success" }]);
	});

	test("the result that names our user message settles the turn", () => {
		const { tracker, outcomes } = makeTracker();
		tracker.expectTurn("ours");

		const decision = tracker.onSdkMessage(resultMessage({ uuid: "ours" }));
		expect(decision).toEqual({
			action: "forward_and_settle",
			outcome: { kind: "success" },
		});
		expect(outcomes).toEqual([{ kind: "success" }]);
	});

	test("a result matching any consumed user message, not only the last, settles the turn", () => {
		const { tracker, outcomes } = makeTracker();
		tracker.expectTurn("first");
		tracker.expectTurn("second");

		const decision = tracker.onSdkMessage(
			resultMessage({ uuid: "second", uuids: ["first", "second"] }),
		);
		expect(decision.action).toBe("forward_and_settle");
		expect(outcomes).toHaveLength(1);
	});

	test("a mini result from a background task ends no turn", () => {
		const { tracker, outcomes, scheduler } = makeTracker();
		tracker.expectTurn("ours");

		expect(tracker.onSdkMessage(resultMessage({ uuid: "ours", numTurns: 0 })).action).toBe(
			"forward",
		);
		expect(outcomes).toEqual([]);
		expect(scheduler.pending()).toBe(0);
	});

	test("a result arriving before an unread steer is held back", () => {
		const { tracker, receipts, outcomes } = makeTracker();
		tracker.expectTurn("ours");
		void receipts.register("steer");

		expect(tracker.onSdkMessage(resultMessage({ uuid: "ours" })).action).toBe("hold_back");
		expect(outcomes).toEqual([]);

		receipts.consume("steer");
		const next = tracker.onSdkMessage(resultMessage({ uuid: "ours" }));
		expect(next.action).toBe("forward_and_settle");
		expect(outcomes).toEqual([{ kind: "success" }]);
	});

	test("the CLI reporting running again disarms the watchdog", () => {
		const { tracker, scheduler } = makeTracker();
		tracker.expectTurn("ours");
		tracker.onSdkMessage(resultMessage({ uuid: "foreign" }));
		expect(scheduler.pending()).toBe(1);

		tracker.onSdkMessage(stateMessage("running"));
		expect(scheduler.pending()).toBe(0);
	});

	test("the stream ending with an error settles the turn as an error", () => {
		const { tracker, outcomes } = makeTracker();
		tracker.expectTurn("ours");

		tracker.onStreamEnded(new Error("Claude Code process exited with code 1"));
		expect(outcomes).toEqual([
			{
				kind: "error",
				message: "Claude Code process exited with code 1",
				retryable: false,
			},
		]);
	});

	test("an is_error result still ends the turn; the translator reports the error", () => {
		const { tracker, outcomes } = makeTracker();
		tracker.expectTurn("ours");

		const decision = tracker.onSdkMessage(resultMessage({ uuid: "ours", isError: true }));
		expect(decision.action).toBe("forward_and_settle");
		expect(outcomes).toEqual([{ kind: "success" }]);
	});

	test("cancel settles the turn at once and late results are dropped", () => {
		const { tracker, outcomes } = makeTracker();
		tracker.expectTurn("ours");

		tracker.cancel();
		expect(outcomes).toEqual([{ kind: "cancelled" }]);
		expect(tracker.onSdkMessage(resultMessage({ uuid: "ours" })).action).toBe("hold_back");
	});
});
