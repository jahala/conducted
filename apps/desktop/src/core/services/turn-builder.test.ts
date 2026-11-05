import type {
	AgentItem,
	FileChange,
	LiveState,
	SessionConfig,
	SessionEvent,
} from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import type { CheckpointId, EventId, MessageId, ToolUseId, TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ChatBlock, ChatTurn } from "../model.ts";
import { buildTurns, classifyTurnsChange, type StoredEvent } from "./turn-builder.ts";

const config: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const user = (
	turn: string,
	messageId: string,
	text: string,
	at: number,
	delivery: "new_turn" | "steer" | "plan_feedback" = "new_turn",
): SessionEvent => ({
	type: "user_message",
	eventId: `${messageId}-event` as EventId,
	at,
	messageId: messageId as MessageId,
	turnId: turn as TurnId,
	text,
	attachmentPaths: [],
	delivery,
	config,
});

const agent = (turn: string, at: number, items: AgentItem[], id = `agent-${at}`): SessionEvent => ({
	type: "agent",
	eventId: id as EventId,
	at,
	turnId: turn as TurnId,
	message: { agent: "claude", items },
});

const ended = (
	turn: string,
	at: number,
	outcome: "success" | "error" | "cancelled" | "interrupted" = "success",
	error?: string,
): SessionEvent => ({
	type: "turn_ended",
	eventId: `end-${turn}` as EventId,
	at,
	turnId: turn as TurnId,
	outcome,
	...(error === undefined ? {} : { error }),
});

const checkpoint = (
	turn: string,
	at: number,
	phase: "start" | "end",
	checkpointId?: string,
	changes?: FileChange[],
): SessionEvent => ({
	type: "checkpoint",
	eventId: `checkpoint-${phase}-${at}` as EventId,
	at,
	turnId: turn as TurnId,
	phase,
	...(checkpointId === undefined ? {} : { checkpointId: checkpointId as CheckpointId }),
	...(changes === undefined ? {} : { changes }),
});

const call = (id: string, parent?: string): AgentItem => ({
	kind: "tool_call",
	toolUseId: id as ToolUseId,
	tool: "bash",
	rawName: "Bash",
	input: { command: "ls" },
	...(parent === undefined ? {} : { parentToolUseId: parent as ToolUseId }),
});

const toolResult = (id: string, output: string, parent?: string): AgentItem => ({
	kind: "tool_result",
	toolUseId: id as ToolUseId,
	output,
	isError: false,
	truncated: false,
	...(parent === undefined ? {} : { parentToolUseId: parent as ToolUseId }),
});

const text = (value: string): AgentItem => ({ kind: "text", text: value });

const thinking = (value: string, summarized = false): AgentItem => ({
	kind: "thinking",
	text: value,
	summarized,
});

const usage = (
	inputTokens: number,
	outputTokens: number,
	extra: Partial<Extract<AgentItem, { kind: "usage" }>> = {},
): AgentItem => ({
	kind: "usage",
	inputTokens,
	outputTokens,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	...extra,
});

const stored = (
	events: readonly SessionEvent[],
	reverted: ReadonlySet<number> = new Set(),
): StoredEvent[] =>
	events.map((event, idx) => ({
		idx,
		event,
		receivedAt: event.at,
		revertedAt: reverted.has(idx) ? event.at + 1 : null,
	}));

const live = (overrides: Partial<LiveState> = {}): LiveState => ({
	...idleLiveState,
	...overrides,
});

function must<T>(value: T | undefined, what: string): T {
	if (value === undefined) throw new Error(`expected ${what}`);
	return value;
}

function firstTurn(...args: Parameters<typeof buildTurns>): ChatTurn {
	return must(buildTurns(...args)[0], "a turn");
}

/** A whole turn: the user's message, one agent reply and its end marker. */
const simpleTurn = (turn: string, value: string, at: number): SessionEvent[] => [
	user(turn, `message-${turn}`, value, at),
	agent(turn, at + 1, [text(`reply to ${value}`)]),
	ended(turn, at + 2),
];

const asToolBlock = (block: ChatBlock | undefined) => {
	if (block?.kind !== "tool")
		throw new Error(`expected a tool block, got ${block?.kind ?? "nothing"}`);
	return block.call;
};

describe("CHAT-07 turn builder", () => {
	it("pairs a tool call with its result from a later event", () => {
		const events = [
			user("turn-1", "message-1", "run it", 100),
			agent("turn-1", 101, [text("working"), call("tool-1")]),
			agent("turn-1", 102, [toolResult("tool-1", "done")]),
			ended("turn-1", 103),
		];

		const turn = firstTurn(stored(events), live());

		expect(turn.blocks).toHaveLength(2);
		expect(turn.blocks[0]).toEqual({ kind: "text", text: "working" });
		const tool = asToolBlock(turn.blocks[1]);
		expect(tool.item.toolUseId).toBe("tool-1");
		expect(tool.result?.output).toBe("done");
	});

	it("groups events into turns by turn id and keeps each user message", () => {
		const events = [...simpleTurn("turn-1", "first", 100), ...simpleTurn("turn-2", "second", 200)];

		const turns = buildTurns(stored(events), live());

		expect(turns.map((turn) => turn.turnId)).toEqual(["turn-1", "turn-2"]);
		expect(must(turns[0], "the first turn").startedBy).toBe("user");
		expect(must(turns[0], "the first turn").userMessage?.text).toBe("first");
		expect(must(turns[1], "the second turn").userMessage?.text).toBe("second");
	});

	it("starts a turn with no user message as started by the agent", () => {
		const events = [agent("turn-1", 100, [text("woke up")]), ended("turn-1", 101)];

		const turn = firstTurn(stored(events), live());

		expect(turn.startedBy).toBe("agent");
		expect(turn.userMessage).toBeNull();
	});

	it("nests sub-agent calls under their parent at any depth", () => {
		const events = [
			user("turn-1", "message-1", "explore", 100),
			agent("turn-1", 101, [call("task")]),
			agent("turn-1", 102, [call("child", "task")]),
			agent("turn-1", 103, [call("grandchild", "child")]),
			agent("turn-1", 104, [toolResult("grandchild", "deep")]),
			ended("turn-1", 105),
		];

		const turn = firstTurn(stored(events), live());
		const tools = turn.blocks.filter((block) => block.kind === "tool");

		expect(tools).toHaveLength(1);
		const parent = asToolBlock(tools[0]);
		expect(parent.item.toolUseId).toBe("task");
		const child = must(parent.children[0], "a child call");
		expect(child.item.toolUseId).toBe("child");
		expect(child.result).toBeNull();
		const grandchild = must(child.children[0], "a grandchild call");
		expect(grandchild.item.toolUseId).toBe("grandchild");
		expect(grandchild.result?.output).toBe("deep");
	});

	it("shows a call without a result as running", () => {
		const events = [
			user("turn-1", "message-1", "wait", 100),
			agent("turn-1", 101, [call("tool-1")]),
		];

		const running = firstTurn(stored(events), live({ status: "working" }));
		const interrupted = firstTurn(stored(events), live());

		expect(asToolBlock(running.blocks[0]).result).toBeNull();
		expect(running.outcome).toBe("running");
		expect(interrupted.outcome).toBe("interrupted");
	});

	it("leaves reverted events out of the turns", () => {
		const events = [...simpleTurn("turn-1", "kept", 100), ...simpleTurn("turn-2", "undone", 200)];

		const turns = buildTurns(stored(events, new Set([3, 4, 5])), live());

		expect(turns.map((turn) => turn.turnId)).toEqual(["turn-1"]);
	});

	it("marks a turn that only partly reverted", () => {
		const events = [
			user("turn-1", "message-1", "keep going", 100),
			agent("turn-1", 101, [text("undone")]),
			agent("turn-1", 102, [text("kept")]),
			ended("turn-1", 103),
		];

		const turn = firstTurn(stored(events, new Set([1])), live());

		expect(turn.reverted).toBe(true);
		expect(turn.blocks).toEqual([{ kind: "text", text: "kept" }]);
	});

	it("marks a steer consumed once the live state no longer lists it", () => {
		const events = [
			user("turn-1", "message-1", "start", 100),
			user("turn-1", "message-2", "also this", 101, "steer"),
			agent("turn-1", 102, [text("ok")]),
			ended("turn-1", 103),
		];

		const pending = firstTurn(
			stored(events),
			live({ pendingSteerIds: ["message-2" as MessageId] }),
		);
		const read = firstTurn(stored(events), live());

		expect(pending.steers).toEqual([
			{ messageId: "message-2", text: "also this", at: 101, consumed: false },
		]);
		expect(must(read.steers[0], "a steer").consumed).toBe(true);
	});

	it("merges a pending send at the end as an optimistic turn", () => {
		const turns = buildTurns(stored(simpleTurn("turn-1", "sent", 100)), live(), [
			{ messageId: "message-pending" as MessageId, text: "still typing", at: 200 },
		]);

		expect(turns).toHaveLength(2);
		expect(must(turns[1], "the pending turn")).toMatchObject({
			turnId: "message-pending",
			startedBy: "user",
			outcome: "running",
			userMessage: { messageId: "message-pending", text: "still typing", at: 200 },
			blocks: [],
		});
	});

	it("does not show a pending send twice once its event is stored", () => {
		const events = [...simpleTurn("turn-1", "sent", 100), ...simpleTurn("turn-2", "arrived", 200)];

		const turns = buildTurns(stored(events), live(), [
			{ messageId: "message-turn-2" as MessageId, text: "arrived", at: 200 },
		]);

		expect(turns.map((turn) => turn.turnId)).toEqual(["turn-1", "turn-2"]);
	});

	it("adds usage items up across the turn", () => {
		const events = [
			user("turn-1", "message-1", "work", 100),
			agent("turn-1", 101, [
				usage(10, 2, {
					cacheReadTokens: 3,
					cacheWriteTokens: 4,
					costUsd: 0.01,
					model: "opus",
					fastMode: true,
				}),
			]),
			agent("turn-1", 102, [
				usage(5, 1, { cacheReadTokens: 1, costUsd: 0.02, model: "sonnet", fastMode: false }),
			]),
			ended("turn-1", 103),
		];

		const turn = firstTurn(stored(events), live());

		expect(turn.usage).toEqual({
			costUsd: 0.03,
			inputTokens: 15,
			outputTokens: 3,
			cacheReadTokens: 4,
			cacheWriteTokens: 4,
			fastMode: false,
			model: "sonnet",
		});
	});

	it("leaves usage null when the agent reports none", () => {
		const turn = firstTurn(stored(simpleTurn("turn-1", "hi", 100)), live());

		expect(turn.usage).toBeNull();
	});

	it("keeps text and thinking items in order", () => {
		const events = [
			user("turn-1", "message-1", "think", 100),
			agent("turn-1", 101, [text("one"), thinking("two"), text("three")]),
			ended("turn-1", 102),
		];

		const turn = firstTurn(stored(events), live());

		expect(turn.blocks).toEqual([
			{ kind: "text", text: "one" },
			{ kind: "thinking", text: "two", summarized: false },
			{ kind: "text", text: "three" },
		]);
	});

	it("turns an unknown item kind into a notice block", () => {
		const unknown = { kind: "future_item", text: "hello" } as unknown as AgentItem;
		const events = [
			user("turn-1", "message-1", "what is this", 100),
			agent("turn-1", 101, [unknown]),
			ended("turn-1", 102),
		];

		const turn = firstTurn(stored(events), live());

		expect(must(turn.blocks[0], "a block").kind).toBe("notice");
	});

	it("carries checkpoint ids and the changed files onto the turn", () => {
		const change: FileChange = {
			path: "src/app.ts",
			status: "modified",
			linesAdded: 2,
			linesRemoved: 1,
			binary: false,
		};
		const events = [
			user("turn-1", "message-1", "edit", 100),
			checkpoint("turn-1", 101, "start", "start-1"),
			agent("turn-1", 102, [text("done")]),
			checkpoint("turn-1", 103, "end", "end-1", [change]),
			ended("turn-1", 104),
		];

		const turn = firstTurn(stored(events), live());

		expect(turn.startCheckpointId).toBe("start-1");
		expect(turn.endCheckpointId).toBe("end-1");
		expect(turn.changes).toEqual([change]);
	});

	it("builds a chat with 20,000 events", () => {
		const events: SessionEvent[] = [];
		for (let index = 0; index < 5000; index += 1) {
			const turn = `turn-${index}`;
			const at = 100 + index * 10;
			events.push(
				user(turn, `message-${index}`, `message ${index}`, at),
				agent(turn, at + 1, [text("working")]),
				agent(turn, at + 2, [thinking("thinking")]),
				ended(turn, at + 3),
			);
		}

		const turns = buildTurns(stored(events), live());

		expect(turns).toHaveLength(5000);
		expect(turns[0]?.turnId).toBe("turn-0");
		expect(turns[4999]?.turnId).toBe("turn-4999");
	});

	it("keeps the error from a failed turn", () => {
		const events = [
			user("turn-1", "message-1", "fail", 100),
			agent("turn-1", 101, [text("trying")]),
			ended("turn-1", 102, "error", "provider refused"),
		];

		const turn = firstTurn(stored(events), live());

		expect(turn.outcome).toBe("error");
		expect(turn.error).toBe("provider refused");
		expect(turn.endedAt).toBe(102);
	});
});

describe("CHAT-07 turn differ", () => {
	const turnsFor = (ids: readonly string[], value = "same"): ReturnType<typeof buildTurns> =>
		buildTurns(stored(ids.flatMap((id, index) => simpleTurn(id, value, 100 + index * 10))), live());

	it("reports an initial build when there were no turns before", () => {
		expect(classifyTurnsChange([], turnsFor(["turn-1"]))).toEqual({ kind: "initial" });
	});

	it("reports no change for two equal builds", () => {
		expect(classifyTurnsChange(turnsFor(["turn-1"]), turnsFor(["turn-1"]))).toEqual({
			kind: "same",
		});
	});

	it("reports a turn appended at the end", () => {
		expect(classifyTurnsChange(turnsFor(["turn-1"]), turnsFor(["turn-1", "turn-2"]))).toEqual({
			kind: "appended",
			fromIndex: 1,
		});
	});

	it("reports a changed tail while a reply streams", () => {
		expect(
			classifyTurnsChange(turnsFor(["turn-1"], "before"), turnsFor(["turn-1"], "after")),
		).toEqual({
			kind: "tail_changed",
			fromIndex: 0,
		});
	});

	it("reports truncated turns lost from the end", () => {
		expect(classifyTurnsChange(turnsFor(["turn-1", "turn-2"]), turnsFor(["turn-1"]))).toEqual({
			kind: "truncated",
			toLength: 1,
		});
	});

	it("reports a turn inserted in the middle", () => {
		expect(
			classifyTurnsChange(turnsFor(["turn-1", "turn-3"]), turnsFor(["turn-1", "turn-2", "turn-3"])),
		).toEqual({ kind: "inserted", atIndex: 1 });
	});

	it("reports a cleared list", () => {
		expect(classifyTurnsChange(turnsFor(["turn-1"]), [])).toEqual({ kind: "cleared" });
	});

	it("treats two empty builds as no change", () => {
		expect(classifyTurnsChange([], [])).toEqual({ kind: "same" });
	});
});
