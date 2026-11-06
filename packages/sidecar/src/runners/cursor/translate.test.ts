import { describe, expect, test } from "bun:test";
import type { ToolUseId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { MAX_TOOL_OUTPUT_CHARS } from "../output.ts";
import type { CursorSdkMessage } from "./cursor-sdk.ts";
import { CursorTranslator } from "./translate.ts";

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

function toolId(id: string): ToolUseId {
	return id as ToolUseId;
}

function translator(): CursorTranslator {
	return new CursorTranslator({ logger: fakeLogger().logger });
}

function assistantText(text: string): CursorSdkMessage {
	return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

function thinking(text: string): CursorSdkMessage {
	return { type: "thinking", text };
}

function toolCall(overrides: Record<string, unknown> = {}): CursorSdkMessage {
	return {
		type: "tool_call",
		call_id: "c1",
		name: "shell",
		status: "running",
		args: { command: "ls" },
		...overrides,
	};
}

describe("AGENT-10 Cursor translation", () => {
	test("buffers text chunks and flushes them before a tool call", () => {
		const cursor = translator();
		expect(cursor.push(assistantText("a"))).toEqual([]);
		expect(cursor.push(assistantText("b"))).toEqual([]);

		const messages = cursor.push(toolCall());

		expect(messages).toHaveLength(2);
		expect(messages[0]?.items).toEqual([{ kind: "text", text: "ab" }]);
		expect(messages[1]?.items).toEqual([
			{
				kind: "tool_call",
				toolUseId: toolId("c1"),
				tool: "bash",
				rawName: "shell",
				input: { command: "ls" },
			},
		]);
	});

	test("flushes buffered text at the end of a turn", () => {
		const cursor = translator();
		cursor.push(assistantText("done"));

		const messages = cursor.flush();

		expect(messages).toHaveLength(1);
		expect(messages[0]?.agent).toBe("cursor");
		expect(messages[0]?.items).toEqual([{ kind: "text", text: "done" }]);
	});

	test("keeps the order when thinking follows text", () => {
		const cursor = translator();
		cursor.push(assistantText("a"));

		const afterThinking = cursor.push(thinking("why"));
		const afterFlush = cursor.flush();

		expect(afterThinking[0]?.items).toEqual([{ kind: "text", text: "a" }]);
		expect(afterFlush[0]?.items).toEqual([{ kind: "thinking", text: "why", summarized: false }]);
	});

	test("emits a call and a result for a completed tool call", () => {
		const cursor = translator();

		const messages = cursor.push(toolCall({ status: "completed", result: "hello" }));

		expect(messages).toHaveLength(2);
		expect(messages[0]?.items[0]).toMatchObject({
			kind: "tool_call",
			toolUseId: toolId("c1"),
			tool: "bash",
		});
		expect(messages[1]?.items[0]).toEqual({
			kind: "tool_result",
			toolUseId: toolId("c1"),
			output: "hello",
			isError: false,
			truncated: false,
		});
	});

	test("marks a failed tool call as an error result", () => {
		const cursor = translator();

		const messages = cursor.push(toolCall({ status: "error", result: { stderr: "boom" } }));

		expect(messages[1]?.items[0]).toEqual({
			kind: "tool_result",
			toolUseId: toolId("c1"),
			output: "boom",
			isError: true,
			truncated: false,
		});
	});

	test("cuts a long tool result and records its original length", () => {
		const cursor = translator();
		const long = "x".repeat(MAX_TOOL_OUTPUT_CHARS + 10);

		const messages = cursor.push(toolCall({ status: "completed", result: long }));
		const item = messages[1]?.items[0];

		expect(item?.kind).toBe("tool_result");
		if (item?.kind !== "tool_result") throw new Error("expected a tool_result item");
		expect(item.truncated).toBe(true);
		expect(item.originalLength).toBe(long.length);
		expect(item.output.length).toBeLessThan(long.length);
	});

	test("translates a separate tool result message", () => {
		const cursor = translator();

		const messages = cursor.push({
			type: "tool_result",
			call_id: "c9",
			content: [{ type: "text", text: "out" }],
			is_error: true,
		});

		expect(messages[0]?.items).toEqual([
			{
				kind: "tool_result",
				toolUseId: toolId("c9"),
				output: "out",
				isError: true,
				truncated: false,
			},
		]);
	});

	test("translates a Cursor error message without retrying it", () => {
		const cursor = translator();

		const messages = cursor.push({ type: "error", content: "model overloaded" });

		expect(messages[0]?.items).toEqual([
			{
				kind: "error",
				code: "cursor_error",
				message: "model overloaded",
				retryable: false,
			},
		]);
	});

	test("reads a tool_use block from an assistant message", () => {
		const cursor = translator();

		const messages = cursor.push({
			type: "assistant",
			message: {
				role: "assistant",
				content: [{ type: "tool_use", id: "u1", name: "createPlan", input: { plan: "x" } }],
			},
		});

		expect(messages[0]?.items).toEqual([
			{
				kind: "tool_call",
				toolUseId: toolId("u1"),
				tool: "exit_plan_mode",
				rawName: "createPlan",
				input: { plan: "x" },
			},
		]);
	});

	test("translates the same call id again in the next turn", () => {
		const cursor = translator();
		cursor.push(toolCall());
		cursor.flush();

		const messages = cursor.push(toolCall());

		expect(messages).toHaveLength(1);
		expect(messages[0]?.items[0]).toMatchObject({ kind: "tool_call", toolUseId: toolId("c1") });
	});

	test("logs and drops a message type we do not translate", () => {
		const { logger, debug } = fakeLogger();
		const cursor = new CursorTranslator({ logger });

		expect(cursor.push({ type: "mystery" })).toEqual([]);

		expect(debug).toHaveLength(1);
		expect(debug[0]?.message).toContain("Cursor");
	});

	test("logs and drops a tool call that has no id", () => {
		const { logger, debug } = fakeLogger();
		const cursor = new CursorTranslator({ logger });

		expect(cursor.push(toolCall({ call_id: undefined }))).toEqual([]);

		expect(debug).toHaveLength(1);
		expect(debug[0]?.message).toContain("id");
	});
});
