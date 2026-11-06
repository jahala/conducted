// @vitest-environment node
import type { SessionEvent } from "@conducted/protocol";
import type { MessageId, ToolUseId, TurnId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { createRepositories } from "../db/repositories.ts";
import { agentEvent, sampleSession, userMessageEvent } from "../db/test-fixtures.ts";
import type { ChatBlock, ChatTurn, ToolCallView } from "../model.ts";
import { formatTranscript, searchHistory, TRANSCRIPT_TOOL_OUTPUT_LIMIT } from "./transcript.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

function toolBlock(rawName: string, input: unknown, output: string): ChatBlock {
	const call: ToolCallView = {
		toolUseId: "tool-1" as ToolUseId,
		item: {
			kind: "tool_call",
			toolUseId: "tool-1" as ToolUseId,
			tool: "bash",
			rawName,
			input,
		},
		result: {
			kind: "tool_result",
			toolUseId: "tool-1" as ToolUseId,
			output,
			isError: false,
			truncated: false,
		},
		children: [],
	};
	return { kind: "tool", call };
}

function turn(over: Partial<ChatTurn> = {}): ChatTurn {
	return {
		turnId: "turn-1" as TurnId,
		startedBy: "user",
		userMessage: {
			messageId: "message-1" as MessageId,
			text: "Please check the logs",
			attachmentPaths: [],
			at: 1000,
			sender: null,
		},
		steers: [],
		blocks: [],
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "success",
		error: null,
		startedAt: 1000,
		endedAt: 2000,
		usage: null,
		reverted: false,
		...over,
	};
}

let test: TestContainer | undefined;

/** A user message with its own text, for search cases the shared fixture's text cannot show. */
function userMessage(id: string, turn: string, at: number, text: string): SessionEvent {
	const event = userMessageEvent(id, turn, at);
	if (event.type !== "user_message") throw new Error("the fixture is a user message");
	return { ...event, text };
}

/** A started container with one chat, and a way to store events in that chat's log. */
async function storedChat() {
	test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const sessions = test.container.services.sessions;
	const chat = must(await sessions.create(workspace.id, sampleSession.config));
	must(await sessions.start());
	const repositories = createRepositories(test.container.platform.db, {
		clock: { now: () => 2000 },
		ids: { uuid: () => crypto.randomUUID() },
	});
	const append = async (event: SessionEvent): Promise<void> => {
		must(await repositories.sessionEvents.append(chat.id, event, event.at));
	};
	return { sessions, chatId: chat.id, append, repositories };
}

afterEach(async () => {
	if (test !== undefined) {
		await test.container.stop();
		test.close();
		test = undefined;
	}
});

describe("CHAT-17 formatTranscript", () => {
	it("lists the user text, then the agent text, then one line per tool call", () => {
		const text = formatTranscript(
			[
				turn({
					blocks: [
						{ kind: "text", text: "I checked them." },
						toolBlock("Bash", { command: "ls" }, "one\ntwo"),
					],
				}),
			],
			"concise",
		);

		expect(text.indexOf("Please check the logs")).toBeLessThan(text.indexOf("I checked them."));
		expect(text.indexOf("I checked them.")).toBeLessThan(text.indexOf("[tool] Bash"));
		expect(text).not.toContain("Input:");
		expect(text).not.toContain("one\ntwo");
	});

	it("adds thinking, tool inputs and tool outputs in the full transcript", () => {
		const text = formatTranscript(
			[
				turn({
					blocks: [
						{ kind: "thinking", text: "The logs are under /tmp.", summarized: false },
						toolBlock("Bash", { command: "ls /tmp" }, "one\ntwo"),
					],
				}),
			],
			"full",
		);

		expect(text).toContain("Thinking: The logs are under /tmp.");
		expect(text).toContain('Input: {"command":"ls /tmp"}');
		expect(text).toContain("Output:\none\ntwo");
	});

	it("leaves a reverted turn out", () => {
		const text = formatTranscript(
			[turn({ reverted: true, blocks: [{ kind: "text", text: "Forget this." }] })],
			"full",
		);
		expect(text).toBe("");
	});

	it("cuts a very large tool output and says how much was left out", () => {
		const output = "x".repeat(TRANSCRIPT_TOOL_OUTPUT_LIMIT + 500);
		const text = formatTranscript([turn({ blocks: [toolBlock("Bash", {}, output)] })], "full");

		expect(text).toContain("x".repeat(TRANSCRIPT_TOOL_OUTPUT_LIMIT));
		expect(text).not.toContain("x".repeat(TRANSCRIPT_TOOL_OUTPUT_LIMIT + 1));
		expect(text).toContain(`[output cut after ${TRANSCRIPT_TOOL_OUTPUT_LIMIT} characters`);
	});
});

describe("CHAT-17 searchHistory", () => {
	it("returns nothing, without searching, for a query shorter than the minimum", async () => {
		const search = vi.fn();
		const result = await searchHistory({ search }, "a", 10);
		expect(result).toEqual({ ok: true, value: [] });
		expect(search).not.toHaveBeenCalled();
	});

	it("trims the query before asking the stored search", async () => {
		const search = vi.fn().mockResolvedValue({ ok: true, value: [] });
		await searchHistory({ search }, "  login  ", 5);
		expect(search).toHaveBeenCalledWith("login", 5);
	});

	it("searches stored chats and returns the matching text with its chat and time", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const sessions = test.container.services.sessions;
		const chat = must(await sessions.create(workspace.id, sampleSession.config));
		must(await sessions.start());

		const repositories = createRepositories(test.container.platform.db, {
			clock: { now: () => 2000 },
			ids: { uuid: () => crypto.randomUUID() },
		});
		const events: SessionEvent[] = [
			userMessageEvent("e1", "turn-1", 100),
			agentEvent("e2", "turn-1", 110, [{ kind: "text", text: "The login bug is fixed." }]),
		];
		for (const event of events) {
			must(await repositories.sessionEvents.append(chat.id, event, event.at));
		}

		const hits = must(await sessions.searchHistory("login", 10));
		expect(hits.map((hit) => hit.sessionId)).toEqual([chat.id, chat.id]);
		expect(hits.map((hit) => hit.excerpt)).toEqual([
			"The login bug is fixed.",
			"Fix the login bug",
		]);
		expect(must(await sessions.searchHistory("a", 10))).toEqual([]);
	});

	it("fills the limit with real matches, not with rows whose JSON keys hold the query", async () => {
		const { sessions, chatId, append } = await storedChat();
		// Every stored event's JSON has a "text" key, but only the oldest message says "text".
		await append(userMessage("e1", "turn-1", 100, "Check the text field"));
		await append(agentEvent("e2", "turn-1", 110, [{ kind: "text", text: "All done." }]));
		await append(agentEvent("e3", "turn-1", 120, [{ kind: "text", text: "Done again." }]));
		await append(agentEvent("e4", "turn-1", 130, [{ kind: "text", text: "Still done." }]));

		const hits = must(await sessions.searchHistory("text", 2));

		expect(hits).toEqual([
			{ sessionId: chatId, turnId: "turn-1", excerpt: "Check the text field", at: 100 },
		]);
	});

	it("finds a query with a quote, which the stored JSON escapes", async () => {
		const { sessions, chatId, append } = await storedChat();
		await append(userMessage("e1", "turn-1", 100, 'Say "hello" twice'));

		const hits = must(await sessions.searchHistory('"hello"', 10));

		expect(hits.map((hit) => [hit.sessionId, hit.excerpt])).toEqual([
			[chatId, 'Say "hello" twice'],
		]);
	});

	it("matches % and _ in the query literally", async () => {
		const { sessions, chatId, append } = await storedChat();
		// The newer rows would match if % and _ were wildcards, and a limit of 1 would keep only them.
		await append(userMessage("e1", "turn-1", 100, "I am 100% sure"));
		await append(userMessage("e2", "turn-2", 200, "I am 100 percent sure"));
		await append(userMessage("e3", "turn-3", 300, "Rename a1_2b"));
		await append(userMessage("e4", "turn-4", 400, "Rename a132b"));

		expect(must(await sessions.searchHistory("100%", 1))).toEqual([
			{ sessionId: chatId, turnId: "turn-1", excerpt: "I am 100% sure", at: 100 },
		]);
		expect(must(await sessions.searchHistory("1_2", 1))).toEqual([
			{ sessionId: chatId, turnId: "turn-3", excerpt: "Rename a1_2b", at: 300 },
		]);
	});

	it("does not search reverted events", async () => {
		const { sessions, chatId, append, repositories } = await storedChat();
		await append(userMessage("e1", "turn-1", 100, "Keep the login form"));
		await append(userMessage("e2", "turn-2", 200, "Drop the login form"));
		expect(
			must(await repositories.sessionEvents.markRevertedFromTurn(chatId, "turn-2" as TurnId, 300)),
		).toBe(1);

		const hits = must(await sessions.searchHistory("login form", 10));

		expect(hits.map((hit) => hit.excerpt)).toEqual(["Keep the login form"]);
	});

	it("copies a chat's transcript to the clipboard through the composition root", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const sessions = test.container.services.sessions;
		const chat = must(await sessions.create(workspace.id, sampleSession.config));
		must(await sessions.start());

		const events: SessionEvent[] = [
			userMessageEvent("e1", "turn-1", 100),
			agentEvent("e2", "turn-1", 110, [{ kind: "text", text: "The login bug is fixed." }]),
		];
		for (const [idx, event] of events.entries()) {
			sessions.applyStoredEvent(chat.id, idx, event, event.at);
		}

		must(await sessions.copyTranscript(chat.id, "concise"));
		const copied = test.memory.controls.clipboardText ?? "";
		expect(copied).toContain("Fix the login bug");
		expect(copied).toContain("The login bug is fixed.");
	});
});
