/**
 * @feature AGENT-03 Claude: translate SDK messages to the neutral format
 * Owns: a smoke test that runs one Claude turn through the real session and translator.
 * Behaviour: research/conductor/claude-runner.md section 1 (one process per chat) and section 2
 * (the SDK stream). The query function is scripted, so no real CLI starts.
 * Test first: a scripted turn yields text, a tool call, its result and usage as neutral items.
 */
import { describe, expect, test } from "bun:test";
import type { CanUseTool, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage, SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { SessionId, ToolUseId, WorkspaceId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import type { StartOptions, TurnCallbacks, TurnInput } from "../runner.ts";
import { ClaudeSession, type ClaudeSessionDeps, type QueryFunction } from "./claude-session.ts";
import { ClaudeTranslator } from "./translate.ts";
import type { Scheduler } from "./turn-tracker.ts";

const logger: Logger = {
	error: () => {},
	warn: () => {},
	info: () => {},
	debug: () => {},
	child: () => logger,
	setLevel: () => {},
};

const scheduler: Scheduler = { after: () => () => {} };

function config(): SessionConfig {
	return {
		agent: "claude",
		model: "claude-sonnet-5",
		effort: "high",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
	};
}

function workspace(): WorkspaceContext {
	return {
		workspaceId: "w1" as WorkspaceId,
		workspaceName: "app",
		workspacePath: "/work/app",
		repoRootPath: "/work/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 4100,
	};
}

function start(): StartOptions {
	return {
		sessionId: "s1" as SessionId,
		config: config(),
		workspace: workspace(),
		env: { PATH: "/usr/bin" },
	};
}

function turnInput(): TurnInput {
	return { text: "run the tests", attachmentPaths: [], config: config() };
}

function callbacks(messages: AgentMessage[]): TurnCallbacks {
	return {
		onMessage: (message) => messages.push(message),
		requestInteraction: async () => ({ kind: "withdrawn" }),
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
	};
}

/** A scripted SDK stream that answers each pushed user message with a whole turn. */
function scriptedQuery(): QueryFunction {
	return ({ prompt, options }) => {
		const out = new AsyncQueue<SDKMessage>();
		options?.abortController?.signal.addEventListener("abort", () => out.close(), { once: true });
		void (async () => {
			for await (const message of prompt) {
				out.push({
					type: "system",
					subtype: "init",
					model: "claude-sonnet-5",
					uuid: "init-uuid",
					session_id: "s1",
				} as unknown as SDKMessage);
				out.push({
					type: "assistant",
					message: {
						role: "assistant",
						content: [
							{ type: "text", text: "Running the tests." },
							{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "bun test" } },
						],
					},
					parent_tool_use_id: null,
					session_id: "s1",
					uuid: "assistant-uuid",
				} as unknown as SDKMessage);
				out.push({
					type: "user",
					message: {
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "tool-1",
								content: "all tests passed",
								is_error: false,
							},
						],
					},
					parent_tool_use_id: null,
					session_id: "s1",
					uuid: "user-uuid",
				} as unknown as SDKMessage);
				out.push({
					type: "result",
					subtype: "success",
					is_error: false,
					num_turns: 1,
					user_message_uuid: String(message.uuid),
					duration_ms: 1,
					duration_api_ms: 1,
					stop_reason: "end_turn",
					total_cost_usd: 0.25,
					usage: { input_tokens: 100, output_tokens: 20, speed: "standard" },
					modelUsage: { main: { outputTokens: 20, contextWindow: 200_000 } },
					permission_denials: [],
					errors: [],
					result: "",
					uuid: "result-uuid",
					session_id: "s1",
				} as unknown as SDKMessage);
			}
		})();
		const iterator = out[Symbol.asyncIterator]();
		return {
			next: () => iterator.next(),
			return: async () => {
				out.close();
				return { value: undefined, done: true };
			},
			throw: async (error: unknown) => {
				out.close();
				throw error;
			},
			[Symbol.asyncIterator]() {
				return this;
			},
			interrupt: async () => {},
			setPermissionMode: async () => {},
			setModel: async () => {},
			applyFlagSettings: async () => {},
			supportedModels: async () => [],
			supportedCommands: async () => [],
			getContextUsage: async () => ({ totalTokens: 0, maxTokens: 0 }),
		} as unknown as Query;
	};
}

function deps(): ClaudeSessionDeps {
	return {
		query: scriptedQuery(),
		executablePath: "/bin/claude",
		appTools: {} as AppToolBackend,
		logger,
		translator: new ClaudeTranslator({ logger }),
		hasTranscript: async () => false,
		realPath: async (path) => path,
		newUuid: () => "turn-uuid",
		scheduler,
		createCanUseTool: () =>
			(async () => ({ behavior: "allow", updatedInput: {} })) as unknown as CanUseTool,
		createMcpServers: () => ({}),
	};
}

describe("AGENT-03 Claude turn smoke test", () => {
	test("a scripted turn reaches the chat as neutral items", async () => {
		const session = new ClaudeSession(deps(), start());
		const messages: AgentMessage[] = [];

		const outcome = await session.runTurn(turnInput(), callbacks(messages));
		const items = messages.flatMap((message) => message.items);

		expect(outcome).toEqual({ kind: "success" });
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
		expect(messages.every((message) => message.raw !== undefined)).toBe(true);

		await session.dispose();
	});
});
