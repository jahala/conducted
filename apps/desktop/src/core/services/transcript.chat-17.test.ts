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
