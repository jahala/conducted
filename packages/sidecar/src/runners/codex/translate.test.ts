import { describe, expect, test } from "bun:test";
import type { AgentItem, AgentMessage } from "@conducted/protocol";
import type { Logger } from "../../logging/logger.ts";
import { MAX_TOOL_OUTPUT_CHARS } from "../output.ts";
import { type CodexImageStager, CodexTranslator } from "./translate.ts";

function fakeLogger(): {
	logger: Logger;
	debug: { message: string; data?: Record<string, unknown> }[];
	warn: { message: string; data?: Record<string, unknown> }[];
} {
	const debug: { message: string; data?: Record<string, unknown> }[] = [];
	const warn: { message: string; data?: Record<string, unknown> }[] = [];
	const logger: Logger = {
		error: () => {},
		warn: (message, data) => warn.push({ message, data }),
		info: () => {},
		debug: (message, data) => debug.push({ message, data }),
		child: () => logger,
		setLevel: () => {},
	};
	return { logger, debug, warn };
}

function translator(options: { stageImage?: CodexImageStager } = {}): CodexTranslator {
	return new CodexTranslator({ logger: fakeLogger().logger, ...options });
}

function items(messages: AgentMessage[]): unknown[] {
	return messages.flatMap((message) => message.items);
}

function commandExecution(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "commandExecution",
		id: "cmd-1",
		command: "bun test",
		cwd: "/work/tree",
		status: "completed",
		aggregatedOutput: "all tests passed",
		exitCode: 0,
		...overrides,
	};
}

describe("AGENT-07 Codex items translate to the neutral format", () => {
	test("a completed commandExecution with exit code 1 yields a bash call and an error result", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			commandExecution({ exitCode: 1, status: "failed", aggregatedOutput: "boom" }),
			"root",
		);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.nativeId).toBe("cmd-1");
		expect(messages[0]?.items as unknown).toEqual([
			{
				kind: "tool_call",
				toolUseId: "cmd-1",
				tool: "bash",
				rawName: "commandExecution",
				input: { command: "bun test", cwd: "/work/tree" },
			},
			{
				kind: "tool_result",
				toolUseId: "cmd-1",
				output: "boom",
				isError: true,
				truncated: false,
			},
		]);
	});

	test("a started and completed tool call emits the call once and the result once", () => {
		const t = translator();
		const started = t.translateItem("started", commandExecution(), "root");
		const completed = t.translateItem("completed", commandExecution(), "root");

		expect(items(started)).toEqual([
			{
				kind: "tool_call",
				toolUseId: "cmd-1",
				tool: "bash",
				rawName: "commandExecution",
				input: { command: "bun test", cwd: "/work/tree" },
			},
		]);
		expect(items(completed)).toEqual([
			{
				kind: "tool_result",
				toolUseId: "cmd-1",
				output: "all tests passed",
				isError: false,
				truncated: false,
			},
		]);
	});

	test("an agent message becomes a text item", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			{ type: "agentMessage", id: "msg-1", text: "All done." },
			"root",
		);
		expect(messages[0]?.items as unknown).toEqual([{ kind: "text", text: "All done." }]);
	});

	test("reasoning prefers a non-empty summary and marks it summarized", () => {
		const t = translator();
		const withSummary = t.translateItem(
			"completed",
			{ type: "reasoning", id: "r-1", summary: ["Summary"], content: ["Full reasoning"] },
			"root",
		);
		const withContent = t.translateItem(
			"completed",
			{ type: "reasoning", id: "r-2", summary: [], content: ["Full reasoning"] },
			"root",
		);

		expect(items(withSummary)).toEqual([{ kind: "thinking", text: "Summary", summarized: true }]);
		expect(items(withContent)).toEqual([
			{ kind: "thinking", text: "Full reasoning", summarized: false },
		]);
	});

	test("a plan becomes a text item", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			{ type: "plan", id: "plan-1", text: "1. Read the code" },
			"root",
		);
		expect(messages[0]?.items as unknown).toEqual([{ kind: "text", text: "1. Read the code" }]);
	});

	test("a file change becomes an edit call and a result with its status", () => {
		const t = translator();
		const changes = [{ path: "src/a.ts", kind: { type: "update", move_path: null }, diff: "@@" }];
		const messages = t.translateItem(
			"completed",
			{ type: "fileChange", id: "file-1", changes, status: "completed" },
			"root",
		);

		expect(messages[0]?.items as unknown).toEqual([
			{
				kind: "tool_call",
				toolUseId: "file-1",
				tool: "edit",
				rawName: "fileChange",
				input: { changes },
			},
			{
				kind: "tool_result",
				toolUseId: "file-1",
				output: "completed",
				isError: false,
				truncated: false,
			},
		]);
	});

	test("an MCP call to our own server maps to app_tool and reads the result content", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			{
				type: "mcpToolCall",
				id: "mcp-1",
				server: "conducted",
				tool: "AskUserQuestion",
				status: "completed",
				arguments: { question: "Which?" },
				result: {
					content: [{ type: "text", text: "The answer" }],
					structuredContent: null,
					_meta: null,
				},
				error: null,
			},
			"root",
		);

		expect(messages[0]?.items as unknown).toEqual([
			{
				kind: "tool_call",
				toolUseId: "mcp-1",
				tool: "app_tool",
				rawName: "mcp__conducted__AskUserQuestion",
				input: { question: "Which?" },
			},
			{
				kind: "tool_result",
				toolUseId: "mcp-1",
				output: "The answer",
				isError: false,
				truncated: false,
			},
		]);
	});

	test("an MCP error becomes an error result", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			{
				type: "mcpToolCall",
				id: "mcp-2",
				server: "linear",
				tool: "get_issue",
				status: "failed",
				arguments: {},
				result: null,
				error: { message: "not found" },
			},
			"root",
		);

		expect(items(messages)[1]).toEqual({
			kind: "tool_result",
			toolUseId: "mcp-2",
			output: "not found",
			isError: true,
			truncated: false,
		});
	});

	test("a dynamic tool call maps to mcp and reads its content items", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			{
				type: "dynamicToolCall",
				id: "dyn-1",
				namespace: null,
				tool: "lookup",
				arguments: { key: "x" },
				status: "completed",
				contentItems: [{ type: "inputText", text: "found it" }],
				success: true,
			},
			"root",
		);

		expect(messages[0]?.items as unknown).toEqual([
			{
				kind: "tool_call",
				toolUseId: "dyn-1",
				tool: "mcp",
				rawName: "lookup",
				input: { key: "x" },
			},
			{
				kind: "tool_result",
				toolUseId: "dyn-1",
				output: "found it",
				isError: false,
				truncated: false,
			},
		]);
	});

	test("a web search maps to web_search with its results", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			{
				type: "webSearch",
				id: "search-1",
				query: "typescript",
				action: null,
				results: [{ title: "TypeScript" }],
			},
			"root",
		);

		expect(messages[0]?.items as unknown).toEqual([
			{
				kind: "tool_call",
				toolUseId: "search-1",
				tool: "web_search",
				rawName: "webSearch",
				input: { query: "typescript" },
			},
			{
				kind: "tool_result",
				toolUseId: "search-1",
				output: '[{"title":"TypeScript"}]',
				isError: false,
				truncated: false,
			},
		]);
	});

	test("image items map to the image tools", () => {
		const t = translator();
		const viewed = t.translateItem(
			"completed",
			{ type: "imageView", id: "view-1", path: "/work/a.png" },
			"root",
		);
		const generated = t.translateItem(
			"completed",
			{
				type: "imageGeneration",
				id: "gen-1",
				status: "completed",
				revisedPrompt: "a cat",
				result: "",
				transparentBackground: false,
				failure: null,
				savedPath: "/tmp/cat.png",
			},
			"root",
		);

		expect(items(viewed)[0]).toMatchObject({
			kind: "tool_call",
			tool: "image_view",
			input: { path: "/work/a.png" },
		});
		expect(items(generated)[0]).toMatchObject({
			kind: "tool_call",
			tool: "image_generation",
		});
		expect(items(generated)[1]).toMatchObject({
			kind: "tool_result",
			output: "/tmp/cat.png",
			isError: false,
		});
	});

	test("a generated image is staged, and a staging failure is logged", () => {
		const { logger, warn } = fakeLogger();
		const calls: { source: string; id: string }[] = [];
		const stager: CodexImageStager = {
			stage: (source, id) => {
				calls.push({ source, id });
				return `/work/.context/images/${id}.png`;
			},
		};
		const t = new CodexTranslator({ logger, stageImage: stager });
		const item = {
			type: "imageGeneration",
			id: "gen-2",
			status: "completed",
			revisedPrompt: "a cat",
			result: "",
			failure: null,
			savedPath: "/tmp/cat.png",
		};
		const staged = t.translateItem("completed", item, "root");
		expect(calls).toEqual([{ source: "/tmp/cat.png", id: "gen-2" }]);
		expect(items(staged)[1]).toMatchObject({
			kind: "tool_result",
			output: "/work/.context/images/gen-2.png",
		});

		const failing = new CodexTranslator({
			logger,
			stageImage: {
				stage: () => {
					throw new Error("no space");
				},
			},
		});
		const kept = failing.translateItem("completed", item, "root");
		expect(items(kept)[1]).toMatchObject({
			kind: "tool_result",
			output: "/tmp/cat.png",
			isError: false,
		});
		expect(warn).toContainEqual({
			message: "Failed to stage generated image inside the workspace",
			data: { path: "/tmp/cat.png", itemId: "gen-2", error: "no space" },
		});
	});

	test("context compaction items and notifications become a compacted notice", () => {
		const t = translator();
		expect(t.translateItem("started", { type: "contextCompaction", id: "c-1" }, "root")).toEqual(
			[],
		);
		expect(
			items(t.translateItem("completed", { type: "contextCompaction", id: "c-1" }, "root")),
		).toEqual([{ kind: "notice", notice: "compacted", text: "Chat history compacted" }]);
		expect(items(t.translateNotification("thread/compacted", { threadId: "root" }))).toEqual([
			{ kind: "notice", notice: "compacted", text: "Chat history compacted" },
		]);
	});

	test("token usage becomes a usage item with the context window", () => {
		const t = translator();
		const breakdown = {
			totalTokens: 0,
			inputTokens: 100,
			cachedInputTokens: 40,
			cacheWriteInputTokens: 2,
			outputTokens: 30,
			reasoningOutputTokens: 5,
		};
		const messages = t.translateNotification("thread/tokenUsage/updated", {
			threadId: "root",
			turnId: "turn-1",
			tokenUsage: {
				total: { ...breakdown, inputTokens: 900 },
				last: breakdown,
				modelContextWindow: 258000,
			},
		});

		expect(items(messages)).toEqual([
			{
				kind: "usage",
				inputTokens: 100,
				outputTokens: 30,
				cacheReadTokens: 40,
				cacheWriteTokens: 2,
				contextWindowTokens: 258000,
			},
		]);
	});

	test("a missing context window leaves the field out", () => {
		const t = translator();
		const breakdown = {
			totalTokens: 1,
			inputTokens: 1,
			cachedInputTokens: 0,
			cacheWriteInputTokens: 0,
			outputTokens: 1,
			reasoningOutputTokens: 0,
		};
		const messages = t.translateNotification("thread/tokenUsage/updated", {
			tokenUsage: { total: breakdown, last: breakdown, modelContextWindow: null },
		});
		expect(items(messages)[0]).toEqual({
			kind: "usage",
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
	});

	test("an error notification keeps willRetry as retryable", () => {
		const t = translator();
		const messages = t.translateNotification("error", {
			error: { message: "rate limit exceeded" },
			willRetry: true,
			threadId: "root",
			turnId: "turn-1",
		});
		expect(items(messages)).toEqual([
			{
				kind: "error",
				code: "agent_rate_limit",
				message: "rate limit exceeded",
				retryable: true,
			},
		]);
	});

	test("a sign-in error names the Codex problem", () => {
		const t = translator();
		const chatgpt = t.translateNotification("error", {
			error: { message: "ChatGPT login expired", codexErrorInfo: "unauthorized" },
			willRetry: false,
		});
		const codex = t.translateNotification("error", {
			error: { message: "not signed in", codexErrorInfo: "unauthorized" },
			willRetry: false,
		});

		expect(items(chatgpt)).toEqual([
			{
				kind: "error",
				code: "agent_auth_required",
				message: "ChatGPT login expired. Sign in to ChatGPT in the agent settings.",
				retryable: false,
			},
		]);
		expect(items(codex)).toEqual([
			{
				kind: "error",
				code: "agent_auth_required",
				message: "Codex authentication required. Sign in to Codex in the agent settings.",
				retryable: false,
			},
		]);
	});

	test("ignored item types produce no messages", () => {
		const t = translator();
		for (const type of [
			"userMessage",
			"hookPrompt",
			"functionCallOutput",
			"sleep",
			"enteredReviewMode",
			"exitedReviewMode",
		]) {
			expect(t.translateItem("completed", { type, id: `${type}-1` }, "root")).toEqual([]);
		}
	});

	test("an unknown item type is logged and does not throw", () => {
		const { logger, debug } = fakeLogger();
		const t = new CodexTranslator({ logger });
		expect(t.translateItem("completed", { type: "somethingNew", id: "x" }, "root")).toEqual([]);
		expect(debug).toContainEqual({
			message: "Ignoring a Codex item type we do not translate",
			data: { type: "somethingNew" },
		});
	});

	test("long tool output keeps its head and tail and is marked truncated", () => {
		const t = translator();
		const long = `${"a".repeat(MAX_TOOL_OUTPUT_CHARS)}ERROR at the end`;
		const messages = t.translateItem(
			"completed",
			commandExecution({ aggregatedOutput: long }),
			"root",
		);
		const result = items(messages)[1] as Extract<AgentItem, { kind: "tool_result" }>;
		expect(result).toMatchObject({ kind: "tool_result", truncated: true });
		expect(result.output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
		expect(result.output.endsWith("ERROR at the end")).toBe(true);
		expect(result.originalLength).toBe(long.length);
	});
});

describe("AGENT-07 Codex sub-agents", () => {
	test("a collaboration call maps to sub_agent and tags a child thread's items with its parent", () => {
		const t = translator();
		const call = t.translateItem(
			"started",
			{
				type: "collabAgentToolCall",
				id: "collab-1",
				tool: "spawnAgent",
				status: "inProgress",
				senderThreadId: "root",
				receiverThreadIds: ["child-1"],
				prompt: "Look into it",
				model: null,
				reasoningEffort: null,
				agentsStates: {},
			},
			"root",
		);
		expect(items(call)[0]).toMatchObject({
			kind: "tool_call",
			tool: "sub_agent",
			toolUseId: "collab-1",
		});

		const child = t.translateItem("completed", commandExecution({ id: "cmd-child" }), "child-1");
		expect(items(child)[0]).toMatchObject({
			kind: "tool_call",
			toolUseId: "cmd-child",
			parentToolUseId: "collab-1",
		});
		expect(items(child)[1]).toMatchObject({
			kind: "tool_result",
			toolUseId: "cmd-child",
			parentToolUseId: "collab-1",
		});

		const parent = t.translateItem("completed", commandExecution({ id: "cmd-parent" }), "root");
		expect(items(parent)[0]).not.toHaveProperty("parentToolUseId");
	});

	test("a completed collaboration call reports the agents' states", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			{
				type: "collabAgentToolCall",
				id: "collab-2",
				tool: "wait",
				status: "completed",
				senderThreadId: "root",
				receiverThreadIds: ["child-1"],
				prompt: null,
				model: null,
				reasoningEffort: null,
				agentsStates: {
					"child-1": { status: "completed", message: "Finished the review" },
				},
			},
			"root",
		);
		expect(items(messages)[1]).toEqual({
			kind: "tool_result",
			toolUseId: "collab-2",
			output: "child-1: completed (Finished the review)",
			isError: false,
			truncated: false,
		});
	});

	test("a sub-agent activity item becomes a status notice", () => {
		const t = translator();
		const messages = t.translateItem(
			"completed",
			{
				type: "subAgentActivity",
				id: "activity-1",
				kind: "completed",
				agentThreadId: "child-1",
				agentPath: "/work/child",
			},
			"root",
		);
		expect(items(messages)).toEqual([
			{ kind: "notice", notice: "info", text: "Sub-agent completed" },
		]);
	});
});
