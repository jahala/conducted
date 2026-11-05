import { describe, expect, test } from "bun:test";
import type { CanUseTool, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage, SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import type { StartOptions, TurnCallbacks, TurnInput } from "../runner.ts";
import { ClaudeRunner, type ClaudeRunnerDeps } from "./claude-runner.ts";
import type { QueryFunction } from "./claude-session.ts";
import type { ClaudeTranslator } from "./translate.ts";
import type { Scheduler } from "./turn-tracker.ts";

const noScheduler: Scheduler = { after: () => () => {} };

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

/**
 * A translator template that records which messages reach each translator its fresh() builds.
 * The runner must call fresh() once per session, or every chat shares the template's state.
 */
function recordingTranslator(): {
	template: ClaudeTranslator;
	seen: string[][];
} {
	const seen: string[][] = [];
	const template = {
		fresh(): ClaudeTranslator {
			const messages: string[] = [];
			seen.push(messages);
			const translator = {
				fresh(): ClaudeTranslator {
					return translator as unknown as ClaudeTranslator;
				},
				translate(message: SDKMessage): AgentMessage[] {
					messages.push(String(message.uuid));
					return [];
				},
			};
			return translator as unknown as ClaudeTranslator;
		},
	};
	return { template: template as unknown as ClaudeTranslator, seen };
}

function initMessage(sessionId: string): SDKMessage {
	return {
		type: "system",
		subtype: "init",
		session_id: sessionId,
		uuid: `init-${sessionId}`,
	} as unknown as SDKMessage;
}

function resultMessage(userMessageUuid: string, sessionId: string): SDKMessage {
	return {
		type: "result",
		subtype: "success",
		is_error: false,
		num_turns: 1,
		user_message_uuid: userMessageUuid,
		duration_ms: 1,
		duration_api_ms: 1,
		stop_reason: "end_turn",
		total_cost_usd: 0,
		usage: {},
		modelUsage: {},
		permission_denials: [],
		errors: [],
		result: "",
		uuid: `result-${sessionId}`,
		session_id: sessionId,
	} as unknown as SDKMessage;
}

/** Answers each pushed user message with an init and a result for that session. */
function scriptedQuery(): QueryFunction {
	return ({ prompt }) => {
		const out = new AsyncQueue<SDKMessage>();
		const iterator = out[Symbol.asyncIterator]();
		void (async () => {
			for await (const message of prompt) {
				const sessionId = String(message.session_id);
				out.push(initMessage(sessionId));
				out.push(resultMessage(String(message.uuid), sessionId));
				out.close();
			}
		})();
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

function startOptions(sessionId: SessionId): StartOptions {
	return {
		sessionId,
		config: config(),
		workspace: workspace(),
		env: { PATH: "/usr/bin" },
	};
}

function turnInput(): TurnInput {
	return { text: "hi", attachmentPaths: [], config: config() };
}

function callbacks(): TurnCallbacks {
	return {
		onMessage: () => {},
		requestInteraction: async () => ({ kind: "withdrawn" }),
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
	};
}

function makeDeps(overrides: Partial<ClaudeRunnerDeps> = {}): ClaudeRunnerDeps {
	const common: RunnerCommonDeps = {
		logger: fakeLogger(),
		clock: { now: () => 0 },
		ids: { uuid: () => "uuid" },
		probe: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
		findExecutable: async () => "/bin/claude",
	};
	let turn = 0;
	return {
		...common,
		query: scriptedQuery(),
		translator: recordingTranslator().template,
		appTools: {} as AppToolBackend,
		hasTranscript: async () => false,
		realPath: async (path) => path,
		newUuid: () => {
			turn += 1;
			return `user-${turn}`;
		},
		scheduler: noScheduler,
		createCanUseTool: () =>
			(async () => ({ behavior: "allow", updatedInput: {} })) as unknown as CanUseTool,
		createMcpServers: () => ({}),
		...overrides,
	};
}

describe("AGENT-03 two chats on one Claude runner", () => {
	test("each session translates with its own translator", async () => {
		const { template, seen } = recordingTranslator();
		const runner = new ClaudeRunner(makeDeps({ translator: template }));

		const sessionA = await runner.start(startOptions("sA" as SessionId));
		const sessionB = await runner.start(startOptions("sB" as SessionId));

		await sessionA.runTurn(turnInput(), callbacks());
		await sessionB.runTurn(turnInput(), callbacks());

		expect(seen).toHaveLength(2);
		expect(seen[0]).toContain("init-sA");
		expect(seen[0]).toContain("result-sA");
		expect(seen[0]).not.toContain("init-sB");
		expect(seen[1]).toContain("init-sB");
		expect(seen[1]).toContain("result-sB");
		expect(seen[1]).not.toContain("init-sA");
	});
});
