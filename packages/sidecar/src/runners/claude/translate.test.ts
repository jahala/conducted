import { describe, expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentItem } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { MAX_TOOL_OUTPUT_CHARS } from "../output.ts";
import { ClaudeTranslator } from "./translate.ts";

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

function translator(): ClaudeTranslator {
	return new ClaudeTranslator({ logger: fakeLogger().logger });
}

function assistant(
	content: unknown[],
	options: { error?: string; parent?: string; uuid?: string } = {},
): SDKMessage {
	return {
		type: "assistant",
		message: { role: "assistant", content },
		parent_tool_use_id: options.parent ?? null,
		session_id: "s1",
		uuid: options.uuid ?? "assistant-uuid",
		...(options.error === undefined ? {} : { error: options.error }),
	} as unknown as SDKMessage;
}

function user(content: unknown[], options: { parent?: string; uuid?: string } = {}): SDKMessage {
	return {
		type: "user",
		message: { role: "user", content },
		parent_tool_use_id: options.parent ?? null,
		session_id: "s1",
		uuid: options.uuid ?? "user-uuid",
	} as unknown as SDKMessage;
}

function result(overrides: Record<string, unknown> = {}): SDKMessage {
	return {
		type: "result",
		subtype: "success",
		is_error: false,
		num_turns: 1,
		duration_ms: 1,
		duration_api_ms: 1,
		stop_reason: "end_turn",
		total_cost_usd: 0,
		usage: {},
		modelUsage: {},
		permission_denials: [],
		errors: [],
		result: "",
		uuid: "result-uuid",
		session_id: "s1",
		...overrides,
	} as unknown as SDKMessage;
}

function system(subtype: string, fields: Record<string, unknown> = {}): SDKMessage {
	return {
		type: "system",
		subtype,
		session_id: "s1",
		uuid: `${subtype}-uuid`,
		...fields,
	} as unknown as SDKMessage;
}

function toolResult(toolUseId: string, content: string, isError = false): unknown {
	return { type: "tool_result", tool_use_id: toolUseId, content, is_error: isError };
}

describe("AGENT-03 Claude translation", () => {
	test("an assistant text block and a Bash tool call become one message in order", () => {
		const t = translator();
		const message = assistant([
			{ type: "text", text: "I will list the files." },
			{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } },
		]);

		const messages = t.translate(message);

		expect(messages).toHaveLength(1);
		expect(messages[0]?.agent).toBe("claude");
		expect(messages[0]?.items).toEqual([
			{ kind: "text", text: "I will list the files." },
			{
				kind: "tool_call",
				toolUseId: "tool-1" as ToolUseId,
				tool: "bash",
				rawName: "Bash",
				input: { command: "ls" },
			},
		]);
		expect(messages[0]?.raw).toBe(message);
	});

	test("thinking becomes a summarized thinking item", () => {
		const t = translator();
		const messages = t.translate(
			assistant([{ type: "thinking", thinking: "Checking the files." }]),
		);
		expect(messages[0]?.items).toEqual([
			{ kind: "thinking", text: "Checking the files.", summarized: true },
		]);
	});

	test("TodoWrite becomes a todo item and its result is dropped", () => {
		const t = translator();
		const call = assistant([
			{
				type: "tool_use",
				id: "todo-1",
				name: "TodoWrite",
				input: {
					todos: [
						{ content: "Write tests", status: "completed" },
						{ content: "Fix bug", status: "in_progress" },
					],
				},
			},
		]);

		expect(t.translate(call)[0]?.items).toEqual([
			{
				kind: "todo",
				items: [
					{ label: "Write tests", status: "done" },
					{ label: "Fix bug", status: "in_progress" },
				],
			},
		]);
		expect(t.translate(user([toolResult("todo-1", "Todo updated")]))).toEqual([]);
	});

	test("tool results keep their text, error flag and parent call", () => {
		const t = translator();
		const call = assistant(
			[{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/a" } }],
			{ parent: "parent-1" },
		);
		expect(t.translate(call)[0]?.items[0]).toMatchObject({
			kind: "tool_call",
			toolUseId: "tool-1" as ToolUseId,
			parentToolUseId: "parent-1" as ToolUseId,
		});

		const messages = t.translate(
			user([toolResult("tool-1", "file contents", true)], { parent: "parent-1" }),
		);
		expect(messages[0]?.items).toEqual([
			{
				kind: "tool_result",
				toolUseId: "tool-1" as ToolUseId,
				output: "file contents",
				isError: true,
				truncated: false,
				parentToolUseId: "parent-1" as ToolUseId,
			},
		]);
	});

	test("a sub-agent's message carries the call that started it", () => {
		const t = translator();
		const messages = t.translate(
			assistant([{ type: "text", text: "inner" }], { parent: "parent-1" }),
		);
		expect(messages[0]?.parentToolUseId as string).toBe("parent-1");
		expect(messages[0]?.items).toEqual([{ kind: "text", text: "inner" }]);
	});

	test("a large tool result keeps its end and says how much was cut", () => {
		const t = translator();
		const text = `${"x".repeat(MAX_TOOL_OUTPUT_CHARS)}THE END`;
		const messages = t.translate(user([toolResult("tool-1", text)]));
		const item = messages[0]?.items[0];
		expect(item).toMatchObject({
			kind: "tool_result",
			toolUseId: "tool-1" as ToolUseId,
			truncated: true,
			originalLength: text.length,
		});
		if (item?.kind !== "tool_result") throw new Error("expected a tool result");
		expect(item.output.endsWith("THE END")).toBe(true);
		expect(item.output).toContain("characters cut");
	});

	// kpa @9558460 renders an assistant payload's blocks whether or not it carries `error`.
	test("an assistant message with an error keeps its text as text (kpa)", () => {
		const t = translator();
		const text = "API Error: 529 Overloaded";
		const messages = t.translate(
			assistant([{ type: "text", text }], { error: "overloaded", uuid: "a1" }),
		);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({ nativeId: "a1", items: [{ kind: "text", text }] });
	});

	test("an assistant message with an error keeps its tool calls and thinking too (kpa)", () => {
		const t = translator();
		const messages = t.translate(
			assistant(
				[
					{ type: "thinking", thinking: "Plan" },
					{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
				],
				{ error: "max_output_tokens" },
			),
		);
		expect(messages[0]?.items.map((item) => item.kind)).toEqual(["thinking", "tool_call"]);
	});

	test("a sign-in failure keeps its text, and its result becomes the sign-in error (SQi, Rpa)", () => {
		const t = translator();
		const text = "Invalid API key · Please run /login";
		const said = t.translate(
			assistant([{ type: "text", text }], { error: "authentication_failed" }),
		);
		expect(said[0]?.items).toEqual([{ kind: "text", text }]);
		const ended = t.translate(result({ is_error: true, result: text }));
		expect(ended[0]?.items).toContainEqual({
			kind: "error",
			code: "agent_auth_required",
			message: text,
			retryable: false,
		});
	});

	test("a result gives a cost delta, the main model, the tier and the fast flag", () => {
		const t = translator();
		const first = result({
			total_cost_usd: 5,
			usage: {
				input_tokens: 10,
				output_tokens: 20,
				cache_read_input_tokens: 3,
				cache_creation_input_tokens: 4,
			},
			modelUsage: {
				small: { outputTokens: 1, contextWindow: 200_000 },
				main: { outputTokens: 19, contextWindow: 1_000_000 },
			},
		});
		const firstMessages = t.translate(first);
		expect(firstMessages[0]?.items).toEqual([
			{
				kind: "usage",
				inputTokens: 10,
				outputTokens: 20,
				cacheReadTokens: 3,
				cacheWriteTokens: 4,
				costUsd: 5,
				model: "main",
				contextWindowTokens: 1_000_000,
			},
		]);

		const second = result({
			total_cost_usd: 5.5,
			usage: { service_tier: "priority", speed: "fast" },
			modelUsage: { main: { outputTokens: 1, contextWindow: 1_000_000 } },
		});
		expect(t.translate(second)[0]?.items[0]).toMatchObject({
			kind: "usage",
			costUsd: 0.5,
			model: "main",
			serviceTier: "priority",
			fastMode: true,
		});
	});

	test("an API error turn shows its text as text and one error, from the result (kpa, Rpa)", () => {
		const t = translator();
		const text = "API Error: 500 Internal server error";
		const messages = [
			...t.translate(assistant([{ type: "text", text }], { error: "server_error" })),
			...t.translate(result({ is_error: true, result: text, api_error_status: 500 })),
		];
		const items = messages.flatMap((message) => message.items);
		expect(items.filter((i) => i.kind === "text")).toEqual([{ kind: "text", text }]);
		expect(items.filter((i) => i.kind === "error")).toEqual([
			{
				kind: "error",
				code: "agent_error",
				message: `Claude Code error: ${text}`,
				retryable: true,
			},
		]);
	});

	// Rpa @9564247: the text is the first error line, else the result; every failed result offers
	// Retry (GFe @9534766 shows it unless told not to).
	test("a result error shows its first error line before the result text, with Retry", () => {
		const t = translator();
		const messages = t.translate(
			result({
				subtype: "error_during_execution",
				is_error: true,
				total_cost_usd: 0.2,
				errors: ["Rate limit reached", "Second line"],
				result: "ignored",
				api_error_status: 429,
			}),
		);
		expect(messages[0]?.items).toContainEqual({
			kind: "error",
			code: "agent_error",
			message: "Claude Code error: Rate limit reached",
			retryable: true,
		});
		expect(messages[0]?.items[0]).toMatchObject({ kind: "usage", costUsd: 0.2 });
	});

	test("a result error with no words reads 'Claude Code error' (Rpa)", () => {
		const t = translator();
		const next = t.translate(
			result({ subtype: "error_max_turns", is_error: true, result: "", errors: [] }),
		);
		expect(next[0]?.items).toContainEqual({
			kind: "error",
			code: "agent_error",
			message: "Claude Code error",
			retryable: true,
		});
	});

	test("a result whose only error lines are diagnostics shows no error (Rpa, Npa)", () => {
		const t = translator();
		const messages = t.translate(
			result({
				subtype: "error_during_execution",
				is_error: true,
				errors: ["[ede_diagnostic] stream closed"],
			}),
		);
		expect(messages[0]?.items).toEqual([expect.objectContaining({ kind: "usage" })]);
	});

	test("a cancelled session reads as interrupted (TQi)", () => {
		const t = translator();
		const messages = t.translate(
			result({ is_error: true, result: "Session cancelled: the user stopped it" }),
		);
		expect(messages[0]?.items).toContainEqual(
			expect.objectContaining({
				message: "Claude Code error: Session interrupted: the user stopped it",
			}),
		);
	});

	test("a sign-in text on an error subtype is a plain error, as SQi only reads success results", () => {
		const t = translator();
		const messages = t.translate(
			result({
				subtype: "error_during_execution",
				is_error: true,
				errors: ["Please run /login"],
			}),
		);
		expect(messages[0]?.items).toContainEqual(
			expect.objectContaining({
				code: "agent_error",
				message: "Claude Code error: Please run /login",
			}),
		);
	});

	test("a sub-agent's API error stays text inside its card, and the result error still shows", () => {
		const t = translator();
		const said = t.translate(
			assistant([{ type: "text", text: "API Error: 529 Overloaded" }], {
				error: "overloaded",
				parent: "toolu_task",
			}),
		);
		expect(said[0]).toMatchObject({
			parentToolUseId: "toolu_task",
			items: [{ kind: "text", text: "API Error: 529 Overloaded" }],
		});
		const messages = t.translate(result({ is_error: true, result: "API Error: 500 boom" }));
		expect(messages[0]?.items).toContainEqual(
			expect.objectContaining({ kind: "error", message: "Claude Code error: API Error: 500 boom" }),
		);
	});

	test("a session limit result shows Conductor's generic result error, with Retry", () => {
		const t = translator();
		const text = "Claude Code session limit reached";
		const messages = t.translate(
			result({ subtype: "error_during_execution", is_error: true, errors: [text] }),
		);
		expect(messages[0]?.items).toContainEqual({
			kind: "error",
			code: "agent_error",
			message: `Claude Code error: ${text}`,
			retryable: true,
		});
	});

	test("compaction frames become compacted and compacting notices", () => {
		const t = translator();
		expect(t.translate(system("compact_boundary"))[0]?.items).toEqual([
			{ kind: "notice", notice: "compacted", text: "Chat history compacted" },
		]);
		expect(t.translate(system("status", { status: "compacting" }))[0]?.items).toEqual([
			{ kind: "notice", notice: "info", text: "Compacting..." },
		]);
		expect(
			t.translate(system("status", { status: null, compact_result: "success" }))[0]?.items,
		).toEqual([{ kind: "notice", notice: "compacted", text: "Chat history compacted" }]);
	});

	test("a rate limit event passes through as a notice unless it is allowed", () => {
		const t = translator();
		expect(
			t.translate({
				type: "rate_limit_event",
				rate_limit_info: { status: "allowed" },
				uuid: "r",
				session_id: "s1",
			} as unknown as SDKMessage),
		).toEqual([]);

		const messages = t.translate({
			type: "rate_limit_event",
			rate_limit_info: { status: "rejected", rateLimitType: "seven_day", utilization: 1 },
			uuid: "r",
			session_id: "s1",
		} as unknown as SDKMessage);
		expect(messages[0]?.items[0]).toMatchObject({ kind: "notice", notice: "rate_limit" });
	});

	test("a second init means a respawn and resets the start notice and cost baseline", () => {
		const t = translator();
		expect(t.translate(system("init", { model: "claude" }))[0]?.items).toEqual([
			{ kind: "notice", notice: "session_started", text: "Session started" },
		]);
		expect(t.translate(result({ total_cost_usd: 5 }))[0]?.items[0]).toMatchObject({
			kind: "usage",
			costUsd: 5,
		});
		expect(t.translate(system("init", { model: "claude" }))[0]?.items).toEqual([
			{ kind: "notice", notice: "session_started", text: "Session started" },
		]);
		expect(t.translate(result({ total_cost_usd: 0.5 }))[0]?.items[0]).toMatchObject({
			kind: "usage",
			costUsd: 0.5,
		});
	});

	test("a respawn clears the dropped TodoWrite ids of the previous process", () => {
		const t = translator();
		t.translate(system("init", { model: "claude" }));
		t.translate(
			assistant([
				{
					type: "tool_use",
					id: "todo-1",
					name: "TodoWrite",
					input: { todos: [{ content: "Write tests", status: "pending" }] },
				},
			]),
		);
		// The old process never delivered the result; the new one must not inherit the id.
		t.translate(system("init", { model: "claude" }));
		expect(t.translate(user([toolResult("todo-1", "Todo updated")]))[0]?.items).toEqual([
			{
				kind: "tool_result",
				toolUseId: "todo-1" as ToolUseId,
				output: "Todo updated",
				isError: false,
				truncated: false,
			},
		]);
	});

	test("fresh() gives a translator whose state belongs to one chat", () => {
		const first = translator();
		first.translate(system("init", { model: "claude" }));
		first.translate(result({ total_cost_usd: 5 }));

		const second = first.fresh();

		expect(second.translate(system("init", { model: "claude" }))[0]?.items).toEqual([
			{ kind: "notice", notice: "session_started", text: "Session started" },
		]);
		expect(second.translate(result({ total_cost_usd: 0.5 }))[0]?.items[0]).toMatchObject({
			kind: "usage",
			costUsd: 0.5,
		});
	});

	test("a task started in the background shows in the transcript, as Conductor's Background Task row (main @1420230)", () => {
		const t = translator();
		const [message] = t.translate(
			system("task_started", {
				task_id: "task-7",
				description: "Watch the test run",
				prompt: "Report when the suite finishes",
				tool_use_id: "toolu_9",
				task_type: "local_bash",
				is_backgrounded: true,
			}),
		);
		const expected: AgentItem[] = [
			{
				kind: "background_task",
				taskId: "task-7",
				description: "Watch the test run",
				prompt: "Report when the suite finishes",
				toolUseId: "toolu_9" as ToolUseId,
			},
		];
		expect(message?.items).toEqual(expected);
	});

	test("a task Conductor keeps out of the transcript stays out: housekeeping, a foreground task, an agent", () => {
		const t = translator();
		for (const extra of [
			{ skip_transcript: true },
			{ ambient: true },
			{ is_backgrounded: false },
			{ subagent_type: "general-purpose" },
			{ task_type: "local_agent" },
			{ task_type: "remote_agent" },
			{ task_type: "subagent" },
		]) {
			expect(
				t.translate(system("task_started", { task_id: "t", description: "work", ...extra })),
			).toEqual([]);
		}
	});

	test("stream deltas, thinking tokens and task progress are dropped", () => {
		const t = translator();
		for (const message of [
			{ type: "stream_event", event: { type: "content_block_delta" } },
			system("thinking_tokens", { estimated_tokens: 1 }),
			system("task_progress", { task_id: "t" }),
			system("task_started", { task_id: "t", description: "work", skip_transcript: true }),
			system("task_notification", { task_id: "t", status: "completed" }),
			system("task_updated", { task_id: "t", patch: {} }),
			{ type: "keep_alive" },
			{ type: "transcript_mirror", entries: [] },
			{ type: "control_request", request_id: "1" },
		]) {
			expect(t.translate(message as unknown as SDKMessage)).toEqual([]);
		}
	});

	test("a dropped message is dropped on purpose (no debug line), and an unknown one is not (one debug line)", () => {
		const dropped: unknown[] = [
			{ type: "stream_event", event: { type: "content_block_delta" } },
			{ type: "keep_alive" },
			{ type: "transcript_mirror", entries: [] },
			{ type: "control_request", request_id: "1" },
			{ type: "control_response", response: {} },
			{ type: "control_cancel_request", request_id: "1" },
			system("thinking_tokens", { estimated_tokens: 1 }),
			system("task_progress", { task_id: "t" }),
			system("task_started", { task_id: "t", description: "work", skip_transcript: true }),
			system("task_notification", { task_id: "t", status: "completed" }),
			system("task_updated", { task_id: "t", patch: {} }),
			system("session_state_changed", { state: "running" }),
			system("background_tasks_changed", { tasks: [] }),
		];
		const unknown: unknown[] = [
			{ type: "something_new", uuid: "u" },
			system("a_subtype_we_never_saw"),
		];

		for (const message of dropped) {
			const { logger, debug } = fakeLogger();
			const t = new ClaudeTranslator({ logger });
			expect(t.translate(message as SDKMessage)).toEqual([]);
			expect(debug).toEqual([]);
		}
		for (const message of unknown) {
			const { logger, debug } = fakeLogger();
			const t = new ClaudeTranslator({ logger });
			expect(t.translate(message as SDKMessage)).toEqual([]);
			expect(debug).toHaveLength(1);
		}
	});

	test("autocompact state, post-turn summary, session metadata and active goal keep their raw payload", () => {
		const t = translator();
		for (const message of [
			system("autocompact_state", { state: "compacting" }),
			system("post_turn_summary", { summary: "done" }),
			system("session_metadata", { title: "chat" }),
			{ type: "active_goal", value: null, uuid: "goal", session_id: "s1" },
		]) {
			const messages = t.translate(message as unknown as SDKMessage);
			expect(messages).toHaveLength(1);
			expect(messages[0]?.items).toEqual([]);
			expect(messages[0]?.raw).toBe(message);
		}
	});

	test("a user message with no tool result yields no neutral item", () => {
		const t = translator();
		expect(t.translate(user([{ type: "text", text: "hello" }]))).toEqual([]);
	});

	test("an unknown message is ignored with a debug line", () => {
		const { logger, debug } = fakeLogger();
		const t = new ClaudeTranslator({ logger });
		expect(t.translate({ type: "something_new", uuid: "u" } as unknown as SDKMessage)).toEqual([]);
		expect(debug).toHaveLength(1);
	});

	test("a whole turn passes through the real translator", () => {
		const t = translator();
		const emitted = [
			system("init", { model: "claude-sonnet" }),
			assistant([
				{ type: "text", text: "Running the tests." },
				{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "bun test" } },
			]),
			user([toolResult("tool-1", "all tests passed")]),
			result({
				total_cost_usd: 0.25,
				usage: { input_tokens: 100, output_tokens: 20, speed: "standard" },
				modelUsage: { main: { outputTokens: 20, contextWindow: 200_000 } },
			}),
		];
		const items = emitted.flatMap((message) => t.translate(message).flatMap((m) => m.items));

		expect(items).toContainEqual({
			kind: "notice",
			notice: "session_started",
			text: "Session started",
		});
		expect(items).toContainEqual({ kind: "text", text: "Running the tests." });
		expect(items).toContainEqual({
			kind: "tool_call",
			toolUseId: "tool-1" as ToolUseId,
			tool: "bash",
			rawName: "Bash",
			input: { command: "bun test" },
		});
		expect(items).toContainEqual({
			kind: "tool_result",
			toolUseId: "tool-1" as ToolUseId,
			output: "all tests passed",
			isError: false,
			truncated: false,
		});
		expect(items).toContainEqual({
			kind: "usage",
			inputTokens: 100,
			outputTokens: 20,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costUsd: 0.25,
			model: "main",
			contextWindowTokens: 200_000,
			fastMode: false,
		});
	});
});
