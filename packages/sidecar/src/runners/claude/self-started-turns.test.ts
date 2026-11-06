import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "@conducted/protocol";
import type { SelfStartedTurnEnd } from "../../session/self-started-turns.ts";
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

/** Translates assistant text the way the real translator does; every other message yields none. */
function translate(message: SDKMessage): AgentMessage[] {
	if (message.type !== "assistant") return [];
	const content = message.message.content;
	if (typeof content === "string")
		return [{ agent: "claude", items: [{ kind: "text", text: content }] }];
	const text = content.map((block) => (block.type === "text" ? block.text : "")).join("");
	return text === "" ? [] : [{ agent: "claude", items: [{ kind: "text", text }] }];
}

function harness() {
	const changes: boolean[] = [];
	const ends: (SelfStartedTurnEnd | undefined)[] = [];
	const messages: AgentMessage[] = [];
	let ownTurn = false;
	const tracker = new SelfStartedTurnTracker({
		callbacks: {
			onInProgressChanged: (inProgress, end) => {
				changes.push(inProgress);
				ends.push(end);
			},
			onMessage: (message) => messages.push(message),
			requestInteraction: async () => ({ kind: "withdrawn" }),
		},
		ownTurnOpen: () => ownTurn,
		translate,
	});
	return {
		tracker,
		changes,
		ends,
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
		expect(h.ends).toEqual([undefined, { outcome: "success" }]);
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

	test("AGENT-15 a result ends work the CLI started as success", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onSdkMessage(resultMessage());
		expect(h.changes).toEqual([true, false]);
		expect(h.ends).toEqual([undefined, { outcome: "success" }]);
	});

	test("AGENT-15 a mini result is no boundary", () => {
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

	test("AGENT-15 the stream ending cleanly while in progress reports interrupted", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onStreamEnded();

		expect(h.changes).toEqual([true, false]);
		expect(h.ends).toEqual([undefined, { outcome: "interrupted" }]);
	});

	test("AGENT-15 a stream that threw reports an error with its message", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onStreamEnded(new Error("the CLI exited"));

		expect(h.changes).toEqual([true, false]);
		expect(h.ends).toEqual([undefined, { outcome: "error", error: "the CLI exited" }]);
	});

	test("AGENT-15 dispose stops every later report", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.dispose();
		h.tracker.onSdkMessage(stateMessage("idle"));
		h.tracker.onStreamEnded();

		expect(h.changes).toEqual([true]);
	});

	test("AGENT-15 messages of work the CLI started are translated and forwarded", () => {
		const h = harness();

		h.tracker.onSdkMessage(stateMessage("running"));
		h.tracker.onSdkMessage(textMessage("background task done"));

		expect(h.messages).toEqual([
			{ agent: "claude", items: [{ kind: "text", text: "background task done" }] },
		]);
	});

	test("AGENT-15 a message before the state report opens the work and is forwarded", () => {
		const h = harness();

		h.tracker.onSdkMessage(textMessage("late wake"));
		h.tracker.onSdkMessage(stateMessage("idle"));

		expect(h.changes).toEqual([true, false]);
		expect(h.ends).toEqual([undefined, { outcome: "success" }]);
		expect(h.messages).toHaveLength(1);
	});

	test("AGENT-15 messages of a turn of ours are left to the turn callbacks", () => {
		const h = harness();
		h.openOwnTurn();

		h.tracker.onSdkMessage(textMessage("hello"));

		expect(h.changes).toEqual([]);
		expect(h.messages).toEqual([]);
	});
});
