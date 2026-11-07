import { describe, expect, test } from "bun:test";
import type {
	CanUseTool,
	Options,
	Query,
	SDKControlGetUsageResponse,
	SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import {
	ClaudeSession,
	type ClaudeSessionDeps,
	type QueryFunction,
} from "../runners/claude/claude-session.ts";
import type { ClaudeTranslator } from "../runners/claude/translate.ts";
import type { Scheduler } from "../runners/claude/turn-tracker.ts";
import type { StartOptions } from "../runners/runner.ts";
import { countingIds } from "../test-support/ids.ts";
import type { AppToolBackend } from "../tools/backend.ts";
import { AsyncQueue } from "../util/async-queue.ts";

function fakeLogger(): Logger {
	const logger: Logger = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => logger,
		setLevel: () => {},
	};
	return logger;
}

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
		host: { kind: "local" },
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

function makeDeps(overrides: Partial<ClaudeSessionDeps> = {}): ClaudeSessionDeps {
	return {
		query: () => {
			throw new Error("no query was provided");
		},
		executablePath: "/bin/claude",
		appTools: {} as AppToolBackend,
		logger: fakeLogger(),
		translator: { translate: () => [] } as unknown as ClaudeTranslator,
		hasTranscript: async () => false,
		readUserMessageText: async () => null,
		realPath: async (path) => path,
		newUuid: countingIds("turn").uuid,
		scheduler: { after: () => () => {} } as Scheduler,
		createCanUseTool: () =>
			(async () => ({ behavior: "allow", updatedInput: {} })) as unknown as CanUseTool,
		createMcpServers: () => ({}) as NonNullable<Options["mcpServers"]>,
		...overrides,
	};
}

/**
 * A query that stays open until abort, like the real SDK process. `usage` is the answer the
 * SDK's experimental usage request gives.
 */
function usageQuery(answer: () => Promise<SDKControlGetUsageResponse>): {
	query: QueryFunction;
	asked: { skipBehaviors?: boolean }[];
} {
	const messages = new AsyncQueue<SDKMessage>();
	const iterator = messages[Symbol.asyncIterator]();
	const asked: { skipBehaviors?: boolean }[] = [];
	const query = {
		next: () => iterator.next(),
		return: async () => {
			messages.close();
			return { value: undefined, done: true };
		},
		throw: async (error: unknown) => {
			messages.close();
			throw error;
		},
		[Symbol.asyncIterator]() {
			return this;
		},
		usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (options?: {
			skipBehaviors?: boolean;
		}) => {
			asked.push(options ?? {});
			return answer();
		},
	} as unknown as Query;
	const queryFn: QueryFunction = ({ prompt, options }) => {
		options?.abortController?.signal.addEventListener("abort", () => messages.close(), {
			once: true,
		});
		void (async () => {
			for await (const _message of prompt) {
				// The session writes user messages into this stream.
			}
		})();
		return query;
	};
	return { query: queryFn, asked };
}

function usageResponse(): SDKControlGetUsageResponse {
	return {
		session: {
			total_cost_usd: 0,
			total_api_duration_ms: 0,
			total_duration_ms: 0,
			total_lines_added: 0,
			total_lines_removed: 0,
			model_usage: {},
		},
		subscription_type: "max",
		rate_limits_available: true,
		rate_limits: {
			five_hour: { utilization: 42, resets_at: "2026-11-04T10:00:00Z" },
			seven_day: { utilization: 60, resets_at: "2026-11-09T00:00:00Z" },
		},
	} as SDKControlGetUsageResponse;
}

describe("SIDE-17 the Claude session reads plan usage from the SDK", () => {
	test("SIDE-17 planUsage asks the SDK without the behavior scan and converts its limits", async () => {
		const { query, asked } = usageQuery(async () => usageResponse());
		const session = new ClaudeSession(makeDeps({ query }), start());
		await session.warm();

		const limits = await session.planUsage();

		expect(asked).toEqual([{ skipBehaviors: true }]);
		expect(limits).toEqual([
			{
				label: "5-hour limit",
				usedPercent: 42,
				windowMinutes: 300,
				resetsAt: Date.parse("2026-11-04T10:00:00Z"),
			},
			{
				label: "7-day limit",
				usedPercent: 60,
				windowMinutes: 10_080,
				resetsAt: Date.parse("2026-11-09T00:00:00Z"),
			},
		]);
		await session.dispose();
	});

	test("SIDE-17 a refused plan usage request reaches the caller, which logs it", async () => {
		const { query } = usageQuery(async () => {
			throw new Error("not signed in with a plan");
		});
		const session = new ClaudeSession(makeDeps({ query }), start());
		await session.warm();

		await expect(session.planUsage()).rejects.toThrow("not signed in with a plan");
		await session.dispose();
	});
});
