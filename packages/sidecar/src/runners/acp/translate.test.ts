import { describe, expect, test } from "bun:test";
import type { SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk";
import type { ToolUseId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { AcpTranslator } from "./translate.ts";

function fakeLogger(): {
	logger: Logger;
	debug: { message: string; data?: Record<string, unknown> }[];
} {
	const debug: { message: string; data?: Record<string, unknown> }[] = [];
	const logger: Logger = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: (message, data) => debug.push({ message, data }),
		child: () => logger,
		setLevel: () => {},
	};
	return { logger, debug };
}

function translator(hints: Record<string, "glob"> = {}): AcpTranslator {
	return new AcpTranslator({ logger: fakeLogger().logger, toolNameHints: hints });
}

function text(textValue: string): SessionUpdate {
	return {
		sessionUpdate: "agent_message_chunk",
		content: { type: "text", text: textValue },
	} as SessionUpdate;
}

function thought(textValue: string): SessionUpdate {
	return {
		sessionUpdate: "agent_thought_chunk",
		content: { type: "text", text: textValue },
	} as SessionUpdate;
}

function image(): SessionUpdate {
	return {
		sessionUpdate: "agent_message_chunk",
		content: { type: "image", data: "aGk=", mimeType: "image/png" },
	} as SessionUpdate;
}

function toolCall(overrides: Record<string, unknown> = {}): SessionUpdate {
	return {
		sessionUpdate: "tool_call",
		toolCallId: "c1",
		title: "Run a command",
		name: "shell",
		kind: "execute",
		rawInput: { command: "ls" },
		...overrides,
	} as SessionUpdate;
}

function toolUpdate(
	status: string,
	content: ToolCallContent[] | undefined,
	overrides: Record<string, unknown> = {},
): SessionUpdate {
	return {
		sessionUpdate: "tool_call_update",
		toolCallId: "c1",
		status,
		...(content === undefined ? {} : { content }),
		...overrides,
	} as SessionUpdate;
}

function contentText(value: string): ToolCallContent {
	return { type: "content", content: { type: "text", text: value } };
}

describe("AGENT-12 ACP translation", () => {
	test("two text chunks then a tool call yield text then the tool call in order", () => {
		const t = translator();
		expect(t.push(text("a"))).toEqual([]);
		expect(t.push(text("b"))).toEqual([]);

		const messages = t.push(toolCall());

		expect(messages).toHaveLength(2);
		expect(messages[0]?.agent).toBe("acp");
		expect(messages[0]?.items).toEqual([{ kind: "text", text: "ab" }]);
		expect(messages[1]?.items).toEqual([
			{
				kind: "tool_call",
				toolUseId: "c1" as ToolUseId,
				tool: "bash",
				rawName: "shell",
				input: { command: "ls" },
			},
		]);
	});

	test("a thought after text keeps the two in one buffered message in order", () => {
		const t = translator();
		t.push(text("first"));
		t.push(thought("second"));
		const messages = t.flush();
		expect(messages).toHaveLength(1);
		expect(messages[0]?.items).toEqual([
			{ kind: "text", text: "first" },
			{ kind: "thinking", text: "second", summarized: false },
		]);
	});

	test("a tool name hint renames the tool over its kind", () => {
		const t = translator({ find: "glob" });
		const messages = t.push(
			toolCall({ name: "find", kind: "search", title: "Find files", rawInput: { pattern: "*" } }),
		);
		expect(messages[0]?.items[0]).toMatchObject({ tool: "glob", rawName: "find" });
	});

	test("a result that arrives before its call waits for the call", () => {
		const t = translator();
		expect(t.push(toolUpdate("completed", [contentText("done")]))).toEqual([]);

		const messages = t.push(toolCall());

		expect(messages).toHaveLength(2);
		expect(messages[1]?.items).toEqual([
			{
				kind: "tool_result",
				toolUseId: "c1" as ToolUseId,
				output: "done",
				isError: false,
				truncated: false,
			},
		]);
	});

	test("a failed call shows its diff as an edited file and an error result", () => {
		const t = translator();
		t.push(toolCall({ kind: "edit", name: "write" }));
		const messages = t.push(
			toolUpdate("failed", [{ type: "diff", path: "/tmp/a.ts", oldText: "a", newText: "b" }]),
		);
		expect(messages[0]?.items).toEqual([
			{
				kind: "tool_result",
				toolUseId: "c1" as ToolUseId,
				output: "Edited /tmp/a.ts",
				isError: true,
				truncated: false,
			},
		]);
	});

	test("only the first terminal update for a call makes a result", () => {
		const t = translator();
		t.push(toolCall());
		expect(t.push(toolUpdate("completed", [contentText("first")]))).toHaveLength(1);
		expect(t.push(toolUpdate("failed", [contentText("second")]))).toEqual([]);
	});

	test("a plan becomes a todo item with our status names", () => {
		const t = translator();
		const messages = t.push({
			sessionUpdate: "plan",
			entries: [
				{ content: "Read the files", priority: "high", status: "completed" },
				{ content: "Change them", priority: "medium", status: "in_progress" },
				{ content: "Run the tests", priority: "low", status: "pending" },
			],
		} as SessionUpdate);
		expect(messages[0]?.items).toEqual([
			{
				kind: "todo",
				items: [
					{ label: "Read the files", status: "done" },
					{ label: "Change them", status: "in_progress" },
					{ label: "Run the tests", status: "pending" },
				],
			},
		]);
	});

	test("a usage update feeds context usage", () => {
		const t = translator();
		const messages = t.push({
			sessionUpdate: "usage_update",
			used: 12_000,
			size: 200_000,
		} as SessionUpdate);
		expect(messages[0]?.items).toEqual([
			{
				kind: "usage",
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				contextUsedTokens: 12_000,
				contextWindowTokens: 200_000,
			},
		]);
	});

	test("an error notice becomes an error item and a completed compaction becomes a notice", () => {
		const t = translator();
		const messages = t.push({
			sessionUpdate: "notice",
			severity: "error",
			title: "Provider failed",
			description: "Try again",
		} as SessionUpdate);
		expect(messages[0]?.items).toEqual([
			{
				kind: "error",
				code: "agent_notice",
				message: "Provider failed: Try again",
				retryable: false,
			},
		]);

		const compacted = t.push({
			sessionUpdate: "compaction_update",
			compactionId: "compact-1",
			status: "completed",
		} as SessionUpdate);
		expect(compacted[0]?.items).toEqual([
			{ kind: "notice", notice: "compacted", text: "Chat history compacted" },
		]);
	});

	test("a non-text content block is shown as a placeholder", () => {
		const t = translator();
		t.push(image());
		expect(t.flush()[0]?.items).toEqual([{ kind: "text", text: "[image]" }]);
	});

	test("a non-text tool result block is shown as a placeholder", () => {
		const t = translator();
		t.push(toolCall());
		const messages = t.push(
			toolUpdate("completed", [
				{ type: "content", content: { type: "image", data: "aGk=", mimeType: "image/png" } },
			]),
		);
		expect(messages[0]?.items[0]).toMatchObject({
			kind: "tool_result",
			toolUseId: "c1" as ToolUseId,
			output: "[image]",
		});
	});

	test("flush emits buffered text and drops a result whose call never arrived", () => {
		const logger = fakeLogger();
		const t = new AcpTranslator({ logger: logger.logger, toolNameHints: {} });
		t.push(text("still here"));
		t.push(toolUpdate("completed", [contentText("orphan")]));

		const messages = t.flush();

		expect(messages[0]?.items).toEqual([{ kind: "text", text: "still here" }]);
		expect(logger.debug).toHaveLength(1);
		expect(logger.debug[0]?.message).toContain("whose call never arrived");
	});
});
