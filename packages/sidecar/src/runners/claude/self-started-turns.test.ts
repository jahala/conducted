import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "@conducted/protocol";
import { SelfStartedTurnTracker } from "./self-started-turns.ts";

function stateMessage(state: "idle" | "running" | "requires_action"): SDKMessage {
	return {
		type: "system",
		subtype: "session_state_changed",
		state,
		uuid: "state-uuid",
		session_id: "s1",
	} as unknown as SDKMessage;
}

function resultMessage(options: { numTurns?: number } = {}): SDKMessage {
	return {
		type: "result",
		subtype: "success",
		is_error: false,
		num_turns: options.numTurns ?? 1,
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

function textMessage(text: string): SDKMessage {
	return {
		type: "assistant",
		message: { role: "assistant", content: [{ type: "text", text }] },
		parent_tool_use_id: null,
		uuid: "assistant-uuid",
		session_id: "s1",
	} as unknown as SDKMessage;
}

function harness() {
	const changes: boolean[] = [];
	const messages: AgentMessage[] = [];
	let ownTurn = false;
	const tracker = new SelfStartedTurnTracker({
		callbacks: {
			onInProgressChanged: (inProgress) => changes.push(inProgress),
			onMessage: (message) => messages.push(message),
		},
		ownTurnOpen: () => ownTurn,
	});
	return {
		tracker,
		changes,
		messages,
		openOwnTurn: () => {
			ownTurn = true;
		},
		closeOwnTurn: () => {
			ownTurn = false;
		},
	};
}

describe("AGENT-15 self-started turns", () => {
	test("AGENT-15 a running then idle stream with no turn open reports in progress and back", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onSdkMessage(stateMessage("idle"));

		expect(h.changes).toEqual([true, false]);
	});

	test("AGENT-15 repeated states are not reported again", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onSdkMessage(stateMessage("idle"));
		h.tracker.onSdkMessage(stateMessage("idle"));

		expect(h.changes).toEqual([true, false]);
	});

	test("AGENT-15 a state change while our own turn runs is not reported", () => {
		const h = harness();
		h.openOwnTurn();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onSdkMessage(stateMessage("idle"));

		expect(h.changes).toEqual([]);
	});

	test("AGENT-15 a result ends work the CLI started, but a mini result is no boundary", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onSdkMessage(resultMessage({ numTurns: 0 }));
		expect(h.changes).toEqual([true]);

		h.tracker.onSdkMessage(resultMessage());
		expect(h.changes).toEqual([true, false]);
	});

	test("AGENT-15 a result while our own turn runs is not ours to report", () => {
		const h = harness();
		h.openOwnTurn();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onSdkMessage(resultMessage());

		expect(h.changes).toEqual([]);
	});

	test("AGENT-15 the stream ending while in progress reports not in progress", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onStreamEnded();

		expect(h.changes).toEqual([true, false]);
	});

	test("AGENT-15 dispose stops every later report", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.dispose();
		h.tracker.onSdkMessage(stateMessage("idle"));
		h.tracker.onStreamEnded();

		expect(h.changes).toEqual([true]);
	});

	test("AGENT-15 messages of ordinary work are left to the turn callbacks", () => {
		const h = harness();

		h.tracker.onSdkMessage(textMessage("hello"));

		expect(h.changes).toEqual([]);
		expect(h.messages).toEqual([]);
	});
});
