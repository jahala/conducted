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
import type { ChatBlock, ChatTurn, ToolCallView } from "../model.ts";
import { buildTurns, type StoredEvent, TurnBuilder } from "./turn-builder.ts";

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

/** A message from a sub-agent, which Conductor keeps inside the call that started it. */
const subAgent = (turn: string, at: number, items: AgentItem[], parent: string): SessionEvent => ({
	type: "agent",
	eventId: `sub-agent-${at}` as EventId,
	at,
	turnId: turn as TurnId,
	message: { agent: "claude", parentToolUseId: parent as ToolUseId, items },
});

const todo = (label: string): AgentItem => ({
	kind: "todo",
	items: [{ label, status: "pending" }],
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

/** The tool calls inside a card's blocks, in order. */
const childCalls = (call: ToolCallView): ToolCallView[] =>
	call.blocks.flatMap((block) => (block.kind === "tool" ? [block.call] : []));

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
		const child = must(childCalls(parent)[0], "a child call");
		expect(child.item.toolUseId).toBe("child");
		expect(child.result).toBeNull();
		const grandchild = must(childCalls(child)[0], "a grandchild call");
		expect(grandchild.item.toolUseId).toBe("grandchild");
		expect(grandchild.result?.output).toBe("deep");
	});

	it("keeps a sub-agent's text, todo and calls inside the parent call", () => {
		const events = [
			user("turn-1", "message-1", "explore", 100),
			agent("turn-1", 101, [call("task")]),
			subAgent("turn-1", 102, [text("inner note"), todo("step one")], "task"),
			subAgent("turn-1", 103, [call("child")], "task"),
			ended("turn-1", 104),
		];

		const turn = firstTurn(stored(events), live());

		expect(turn.blocks).toHaveLength(1);
		const parent = asToolBlock(turn.blocks[0] as ChatBlock);
		expect(parent.item.toolUseId).toBe("task");
		expect(parent.blocks.map((block) => block.kind)).toEqual(["text", "todo", "tool"]);
		expect(childCalls(parent).map((child) => child.item.toolUseId)).toEqual(["child"]);
	});

	it("shows a second user message in a turn as a steer", () => {
		const events = [
			user("turn-1", "message-1", "first", 100),
			user("turn-1", "message-2", "second", 101),
			ended("turn-1", 102),
		];

		const turn = firstTurn(stored(events), live());

		expect(turn.userMessage?.text).toBe("first");
		expect(turn.steers.map((steer) => steer.text)).toEqual(["second"]);
	});

	it("keeps both calls at the top level when their parent links loop", () => {
		const events = [
			user("turn-1", "message-1", "loop", 100),
			agent("turn-1", 101, [call("a", "b")]),
			agent("turn-1", 102, [call("b", "a")]),
			ended("turn-1", 103),
		];

		const turn = firstTurn(stored(events), live());
		const tools = turn.blocks.filter((block) => block.kind === "tool");

		expect(tools.map((block) => asToolBlock(block).item.toolUseId).sort()).toEqual(["a", "b"]);
		expect(asToolBlock(tools[0]).blocks).toEqual([]);
		expect(asToolBlock(tools[1]).blocks).toEqual([]);
	});

	it("shows a notice for a tool result whose call never arrived", () => {
		const events = [
			user("turn-1", "message-1", "orphan", 100),
			agent("turn-1", 101, [toolResult("missing", "lost")]),
			ended("turn-1", 102),
		];

		const turn = firstTurn(stored(events), live());

		expect(turn.blocks).toHaveLength(1);
		const notice = must(turn.blocks[0], "a notice block");
		expect(notice.kind).toBe("notice");
		if (notice.kind !== "notice") throw new Error("expected a notice block");
		expect(notice.item.text).toContain("missing");
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

	it("adds a pending steer to the running turn instead of making a new turn", () => {
		const turns = buildTurns(
			stored([user("turn-1", "message-1", "start", 100)]),
			live({ status: "working" }),
			[{ messageId: "message-steer" as MessageId, text: "also this", at: 200, delivery: "steer" }],
		);
		expect(turns).toHaveLength(1);
		expect(must(turns[0], "the turn").steers).toEqual([
			{ messageId: "message-steer", text: "also this", at: 200, consumed: false },
		]);
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

	// Conductor hides an all-text assistant message whose text is a sign-in error when the turn's
	// result already shows the sign-in view (kpa @9558460 with CQi @9517683).
	describe("a Claude sign-in error", () => {
		const said = "Invalid API key · Please run /login";
		const signIn: AgentItem = {
			kind: "error",
			code: "agent_auth_required",
			message: said,
			retryable: false,
		};

		it("hides the text that repeats it when the turn's result shows the sign-in view", () => {
			const events = [
				user("turn-1", "message-1", "hi", 100),
				agent("turn-1", 101, [text(said)]),
				agent("turn-1", 102, [signIn]),
				ended("turn-1", 103, "error", said),
			];

			expect(firstTurn(stored(events), live()).blocks).toEqual([{ kind: "error", item: signIn }]);
		});

		it("keeps the text when the turn has no sign-in result", () => {
			const events = [
				user("turn-1", "message-1", "hi", 100),
				agent("turn-1", 101, [text(said)]),
				ended("turn-1", 102),
			];

			expect(firstTurn(stored(events), live()).blocks).toEqual([{ kind: "text", text: said }]);
		});

		it("keeps a message that is not all text, and text that is not a sign-in error", () => {
			const events = [
				user("turn-1", "message-1", "hi", 100),
				agent("turn-1", 101, [thinking("why"), text(said)]),
				agent("turn-1", 102, [text("Here is what I found.")]),
				agent("turn-1", 103, [signIn]),
				ended("turn-1", 104, "error", said),
			];

			expect(firstTurn(stored(events), live()).blocks).toEqual([
				{ kind: "thinking", text: "why", summarized: false },
				{ kind: "text", text: said },
				{ kind: "text", text: "Here is what I found." },
				{ kind: "error", item: signIn },
			]);
		});

		it("does not read another agent's sign-in error as Claude's", () => {
			const codex = (at: number, items: AgentItem[]): SessionEvent => ({
				type: "agent",
				eventId: `codex-${at}` as EventId,
				at,
				turnId: "turn-1" as TurnId,
				message: { agent: "codex", items },
			});
			const events = [
				user("turn-1", "message-1", "hi", 100),
				codex(101, [text(said)]),
				codex(102, [signIn]),
				ended("turn-1", 103, "error", said),
			];

			expect(firstTurn(stored(events), live()).blocks).toEqual([
				{ kind: "text", text: said },
				{ kind: "error", item: signIn },
			]);
		});
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

		const rows = stored(events);
		const builder = new TurnBuilder();
		const turns = builder.update(rows, live());

		expect(turns).toHaveLength(5000);
		expect(turns[0]?.turnId).toBe("turn-0");
		expect(turns[4999]?.turnId).toBe("turn-4999");

		const rebuilt = builder.update([...rows], live());
		expect(rebuilt).toHaveLength(5000);
		expect(rebuilt.every((turn, index) => turn === turns[index])).toBe(true);
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

/** A background Task whose call and launch result sit in turn A. */
const backgroundTask = (turn: string, at: number): SessionEvent[] => [
	user(turn, `message-${turn}`, "start a helper", at),
	agent(turn, at + 1, [call("task")]),
	agent(turn, at + 2, [toolResult("task", "Async agent launched")]),
	agent(turn, at + 3, [text("The helper is running.")]),
	ended(turn, at + 4),
];

describe("CHAT-07 a background helper's late work (D129)", () => {
	it("shows a helper's late text and calls inside the card that started it, and the later turn shows its own work only", () => {
		const events = [
			...backgroundTask("turn-a", 100),
			user("turn-b", "message-b", "anything else?", 200),
			subAgent("turn-b", 201, [text("late helper text")], "task"),
			agent("turn-b", 202, [call("child", "task")]),
			agent("turn-b", 203, [toolResult("child", "child done", "task")]),
			agent("turn-b", 204, [text("own work in turn B")]),
			ended("turn-b", 205),
		];

		const [turnA, turnB] = buildTurns(stored(events), live());

		const card = asToolBlock(must(turnA, "turn A").blocks[0]);
		expect(card.toolUseId).toBe("task");
		expect(card.result?.output).toBe("Async agent launched");
		expect(card.blocks.map((block) => block.kind)).toEqual(["text", "tool"]);
		expect(card.blocks[0]).toEqual({ kind: "text", text: "late helper text" });
		const child = must(childCalls(card)[0], "the late child call");
		expect(child.toolUseId).toBe("child");
		expect(child.result?.output).toBe("child done");
		expect(must(turnB, "turn B").blocks).toEqual([{ kind: "text", text: "own work in turn B" }]);
	});

	it("puts late work after what the card already holds, in arrival order, across several turns", () => {
		const events = [
			user("turn-a", "message-a", "start a helper", 100),
			agent("turn-a", 101, [call("task")]),
			subAgent("turn-a", 102, [text("first, in turn A")], "task"),
			ended("turn-a", 103),
			user("turn-b", "message-b", "next", 200),
			subAgent("turn-b", 201, [thinking("second, in turn B")], "task"),
			ended("turn-b", 202),
			user("turn-c", "message-c", "and next", 300),
			subAgent("turn-c", 301, [todo("third, in turn C")], "task"),
			ended("turn-c", 302),
		];

		const turns = buildTurns(stored(events), live());

		const card = asToolBlock(must(turns[0], "turn A").blocks[0]);
		expect(card.blocks.map((block) => block.kind)).toEqual(["text", "thinking", "todo"]);
		expect(turns[1]?.blocks).toEqual([]);
		expect(turns[2]?.blocks).toEqual([]);
	});

	it("nests a late call's own children under it, inside the earlier card", () => {
		const events = [
			...backgroundTask("turn-a", 100),
			user("turn-b", "message-b", "next", 200),
			agent("turn-b", 201, [call("child", "task")]),
			agent("turn-b", 202, [call("grandchild", "child")]),
			ended("turn-b", 203),
		];

		const [turnA, turnB] = buildTurns(stored(events), live());

		const child = must(childCalls(asToolBlock(must(turnA, "turn A").blocks[0]))[0], "a child");
		expect(childCalls(child).map((call) => call.toolUseId)).toEqual(["grandchild"]);
		expect(turnB?.blocks).toEqual([]);
	});

	it("gives a call of an earlier turn the result that arrives in a later turn", () => {
		const events = [
			user("turn-a", "message-a", "start a helper", 100),
			agent("turn-a", 101, [call("task")]),
			agent("turn-a", 102, [call("child", "task")]),
			ended("turn-a", 103),
			user("turn-b", "message-b", "next", 200),
			agent("turn-b", 201, [toolResult("child", "finished later", "task")]),
			ended("turn-b", 202),
		];

		const [turnA, turnB] = buildTurns(stored(events), live());

		const child = must(childCalls(asToolBlock(must(turnA, "turn A").blocks[0]))[0], "a child");
		expect(child.result?.output).toBe("finished later");
		expect(turnB?.blocks).toEqual([]);
	});

	it("keeps work whose parent call never arrived at the top level of the turn it arrives in", () => {
		const events = [
			...backgroundTask("turn-a", 100),
			user("turn-b", "message-b", "next", 200),
			subAgent("turn-b", 201, [text("ghost parent text")], "ghost"),
			agent("turn-b", 202, [call("orphan", "ghost")]),
			ended("turn-b", 203),
		];

		const [turnA, turnB] = buildTurns(stored(events), live());

		expect(asToolBlock(must(turnA, "turn A").blocks[0]).blocks).toEqual([]);
		const blocks = must(turnB, "turn B").blocks;
		expect(blocks.map((block) => block.kind)).toEqual(["text", "tool"]);
		expect(blocks[0]).toEqual({ kind: "text", text: "ghost parent text" });
		expect(asToolBlock(blocks[1]).toolUseId).toBe("orphan");
	});

	it("keeps late work at the top level when the turn that started the helper was reverted", () => {
		const events = [
			...backgroundTask("turn-a", 100),
			user("turn-b", "message-b", "next", 200),
			subAgent("turn-b", 201, [text("late helper text")], "task"),
			ended("turn-b", 202),
		];

		const turns = buildTurns(stored(events, new Set([0, 1, 2, 3, 4])), live());

		expect(turns.map((turn) => turn.turnId)).toEqual(["turn-b"]);
		expect(turns[0]?.blocks).toEqual([{ kind: "text", text: "late helper text" }]);
	});

	it("keeps both calls at the top level when their parent links loop across turns", () => {
		const events = [
			user("turn-a", "message-a", "loop", 100),
			agent("turn-a", 101, [call("a", "b")]),
			ended("turn-a", 102),
			user("turn-b", "message-b", "loop back", 200),
			agent("turn-b", 201, [call("b", "a")]),
			ended("turn-b", 202),
		];

		const [turnA, turnB] = buildTurns(stored(events), live());

		expect(asToolBlock(must(turnA, "turn A").blocks[0]).blocks).toEqual([]);
		expect(asToolBlock(must(turnB, "turn B").blocks[0]).toolUseId).toBe("b");
	});

	it("prefers a parent call in the same turn over one with the same id in an earlier turn", () => {
		const events = [
			user("turn-a", "message-a", "first", 100),
			agent("turn-a", 101, [call("task")]),
			ended("turn-a", 102),
			user("turn-b", "message-b", "second", 200),
			agent("turn-b", 201, [call("task")]),
			subAgent("turn-b", 202, [text("belongs to turn B's call")], "task"),
			ended("turn-b", 203),
		];

		const [turnA, turnB] = buildTurns(stored(events), live());

		expect(asToolBlock(must(turnA, "turn A").blocks[0]).blocks).toEqual([]);
		expect(asToolBlock(must(turnB, "turn B").blocks[0]).blocks).toEqual([
			{ kind: "text", text: "belongs to turn B's call" },
		]);
	});
});

describe("CHAT-07 a long chat with background helpers (D129)", () => {
	const TURNS = 1400;
	const CALLS_PER_TURN = 20;
	/** Every seventh turn starts a helper; it writes into each of the next six turns. */
	const HELPER_EVERY = 7;
	const HELPER_SPAN = 6;

	/** A helper's late text, call and result, written in `turn` under the helper started in `owner`. */
	const lateWork = (turn: number, owner: number, at: number): SessionEvent[] => [
		subAgent(`turn-${turn}`, at, [text(`late from ${owner} in ${turn}`)], `bg-${owner}`),
		agent(`turn-${turn}`, at + 1, [call(`late-${owner}-${turn}`, `bg-${owner}`)]),
		agent(`turn-${turn}`, at + 2, [toolResult(`late-${owner}-${turn}`, "ok", `bg-${owner}`)]),
	];

	function longChat(turns = TURNS): SessionEvent[] {
		const events: SessionEvent[] = [];
		for (let index = 0; index < turns; index += 1) {
			const turn = `turn-${index}`;
			const at = 1_000 + index * 1_000;
			events.push(user(turn, `message-${index}`, `message ${index}`, at));
			if (index % HELPER_EVERY === 0) {
				events.push(agent(turn, at + 1, [call(`bg-${index}`)]));
				events.push(agent(turn, at + 2, [toolResult(`bg-${index}`, "Async agent launched")]));
			}
			const owner = index - (index % HELPER_EVERY);
			if (owner !== index) events.push(...lateWork(index, owner, at + 3));
			for (let step = 0; step < CALLS_PER_TURN; step += 1) {
				const id = `call-${index}-${step}`;
				events.push(agent(turn, at + 10 + step * 2, [call(id)]));
				events.push(agent(turn, at + 11 + step * 2, [toolResult(id, "done")]));
			}
			events.push(ended(turn, at + 900));
		}
		return events;
	}

	/** Milliseconds to build the chat `times` times over. */
	const msToBuild = (events: readonly StoredEvent[], times = 1): number => {
		const start = performance.now();
		for (let run = 0; run < times; run += 1) buildTurns(events, live({ status: "working" }));
		return performance.now() - start;
	};
	const median = (values: number[]): number =>
		[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

	it("builds 1,400 turns from about 60,000 events in time that grows linearly with the events", () => {
		const quarter = stored(longChat(TURNS / 4));
		const whole = stored(longChat());
		expect(whole.length).toBeGreaterThan(60_000);

		// Four builds of a quarter of the chat against one build of all of it: the same work when the
		// build is linear, a quarter of it when the build grows with the square of the size (a per-turn
		// rescan of earlier turns read 6 times the linear ratio here). Interleaved runs, so a busy
		// moment on the machine slows both sides alike.
		const quarters: number[] = [];
		const wholes: number[] = [];
		for (let run = 0; run < 7; run += 1) {
			quarters.push(msToBuild(quarter, 4));
			wholes.push(msToBuild(whole));
		}
		expect(median(wholes) / median(quarters)).toBeLessThan(2);
	}, 60_000);

	it("in a 1,400-turn chat, an appended event replaces only the turn whose view it changes", () => {
		const events = longChat();
		const rows = stored(events);
		const builder = new TurnBuilder();
		const turns = builder.update(rows, live({ status: "working" }));
		expect(turns).toHaveLength(TURNS);
		const firstCard = asToolBlock(must(turns[0], "the first turn").blocks[0]);
		expect(firstCard.blocks).toHaveLength(HELPER_SPAN * 2);
		expect(childCalls(firstCard).every((child) => child.result?.output === "ok")).toBe(true);
		// A later turn shows only its own calls.
		expect(turns[1]?.blocks).toHaveLength(CALLS_PER_TURN);

		// One event appended to the last turn: every earlier turn keeps its object.
		const lastIndex = TURNS - 1;
		const streamed = [
			...rows,
			...stored([agent(`turn-${lastIndex}`, 10_000_000, [text("streaming")])]).map((row) => ({
				...row,
				idx: rows.length,
			})),
		];
		const rebuilt = builder.update(streamed, live({ status: "working" }));
		const changed = rebuilt.flatMap((turn, index) => (turn === turns[index] ? [] : [index]));
		expect(changed).toEqual([lastIndex]);
		expect(rebuilt).toEqual(buildTurns(streamed, live({ status: "working" })));

		// A helper's late event in the last turn: only the turn that started it gets a new object.
		const owner = lastIndex - (lastIndex % HELPER_EVERY);
		const late = [
			...streamed,
			...stored([subAgent(`turn-${lastIndex}`, 10_000_001, [text("one more")], `bg-${owner}`)]).map(
				(row) => ({ ...row, idx: streamed.length }),
			),
		];
		const replaced = builder
			.update(late, live({ status: "working" }))
			.flatMap((turn, index) => (turn === rebuilt[index] ? [] : [index]));
		expect(replaced).toEqual([owner]);
	});
});

describe("CHAT-07 an update rebuilds only the turns it changes (#653)", () => {
	/** Rows for the events, numbered from `from`. */
	const rowsFrom = (from: number, events: readonly SessionEvent[]): StoredEvent[] =>
		stored(events).map((row, index) => ({ ...row, idx: from + index }));
	const simpleRows = (ids: readonly string[], value = "same"): StoredEvent[] =>
		stored(ids.flatMap((id, index) => simpleTurn(id, value, 100 + index * 10)));

	/** For each turn of the second update, whether it is the first update's object. */
	const kept = (first: readonly StoredEvent[], second: readonly StoredEvent[]): boolean[] => {
		const builder = new TurnBuilder();
		const before = builder.update(first, live());
		const after = builder.update(second, live());
		expect(after).toEqual(buildTurns(second, live()));
		return after.map((turn) => before.includes(turn));
	};

	it("keeps every turn when the rows are the same", () => {
		const rows = simpleRows(["turn-1", "turn-2"]);
		expect(kept(rows, [...rows])).toEqual([true, true]);
	});

	it("keeps the earlier turns and takes a turn appended at the end", () => {
		const rows = simpleRows(["turn-1"]);
		expect(kept(rows, [...rows, ...rowsFrom(rows.length, simpleTurn("turn-2", "x", 500))])).toEqual(
			[true, false],
		);
	});

	it("takes the last turn while a reply streams into it", () => {
		const rows = simpleRows(["turn-1", "turn-2"]);
		const more = rowsFrom(rows.length, [agent("turn-2", 900, [text("more")])]);
		expect(kept(rows, [...rows, ...more])).toEqual([true, false]);
	});

	it("takes only the past turn whose card gained a helper's late work, and keeps the turns after it", () => {
		const rows = stored([
			...backgroundTask("turn-a", 100),
			...simpleTurn("turn-b", "b", 200),
			user("turn-c", "message-c", "c", 300),
		]);
		const builder = new TurnBuilder();
		const before = builder.update(rows, live({ status: "working" }));
		const late = [
			...rows,
			...rowsFrom(rows.length, [subAgent("turn-c", 301, [text("late")], "task")]),
		];
		const after = builder.update(late, live({ status: "working" }));
		expect(after.map((turn) => before.includes(turn))).toEqual([false, true, true]);
		expect(after).toEqual(buildTurns(late, live({ status: "working" })));
	});

	it("takes the turns a revert changed and keeps the turns before them", () => {
		const rows = simpleRows(["turn-1", "turn-2", "turn-3"]);
		// The revert of turn 2 marks its rows and every later one, as the store's revert does.
		const reverted = rows.map((row, index) => (index >= 3 ? { ...row, revertedAt: 999 } : row));
		const builder = new TurnBuilder();
		const before = builder.update(rows, live());
		const after = builder.update(reverted, live());
		expect(after).toHaveLength(1);
		expect(after[0]).toBe(before[0]);
	});

	it("keeps the loaded turns when an older turn is merged in at the top", () => {
		const all = simpleRows(["turn-1", "turn-2", "turn-3"]);
		const builder = new TurnBuilder();
		const before = builder.update(all.slice(3), live());
		const after = builder.update(all, live());
		expect(after.map((turn) => before.includes(turn))).toEqual([false, true, true]);
		expect(after).toEqual(buildTurns(all, live()));
	});

	it("takes the turns that lost their rows and gives an empty list when every turn is gone", () => {
		const rows = simpleRows(["turn-1", "turn-2"]);
		const builder = new TurnBuilder();
		const before = builder.update(rows, live());
		expect(builder.update(rows.slice(0, 3), live())).toEqual([before[0]]);
		expect(builder.update([], live())).toEqual([]);
	});

	it("takes only the turn whose steer the agent read", () => {
		const rows = stored([
			...simpleTurn("turn-1", "a", 100),
			user("turn-2", "message-2", "b", 200),
			user("turn-2", "steer-2", "also this", 210, "steer"),
		]);
		const builder = new TurnBuilder();
		const before = builder.update(
			rows,
			live({ status: "working", pendingSteerIds: ["steer-2" as MessageId] }),
		);
		expect(before[1]?.steers[0]?.consumed).toBe(false);
		const after = builder.update(rows, live({ status: "working", pendingSteerIds: [] }));
		expect(after[0]).toBe(before[0]);
		expect(after[1]?.steers[0]?.consumed).toBe(true);
	});

	it("keeps the turns when a pending send is laid over them, and drops it once its event is stored", () => {
		const rows = simpleRows(["turn-1"]);
		const builder = new TurnBuilder();
		const send = { messageId: "message-2" as MessageId, text: "next", at: 500 };
		const before = builder.update(rows, live(), [send]);
		expect(before.map((turn) => turn.userMessage?.text)).toEqual(["same", "next"]);
		const storedSend = [
			...rows,
			...rowsFrom(rows.length, [user("turn-2", "message-2", "next", 500)]),
		];
		const after = builder.update(storedSend, live(), [send]);
		expect(after).toHaveLength(2);
		expect(after[0]).toBe(before[0]);
		expect(after).toEqual(buildTurns(storedSend, live()));
	});
});
