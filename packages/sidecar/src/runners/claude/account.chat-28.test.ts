/**
 * @feature CHAT-28 Account and rate-limit rows in the usage popover
 * Owns: the test that the Claude session reads the signed-in account through the SDK's accountInfo.
 * Behaviour: claude-runner.md 7 and the SDK's accountInfo answer.
 * Test first: accountInfo's subscription type and email become the usage account.
 */
import { describe, expect, test } from "bun:test";
import type { CanUseTool, Options, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { countingIds } from "../../test-support/ids.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import type { StartOptions } from "../runner.ts";
import { ClaudeSession, type ClaudeSessionDeps, type QueryFunction } from "./claude-session.ts";
import type { ClaudeTranslator } from "./translate.ts";
import type { Scheduler } from "./turn-tracker.ts";

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

function makeDeps(
	query: QueryFunction,
	overrides: Partial<ClaudeSessionDeps> = {},
): ClaudeSessionDeps {
	return {
		query,
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

function accountQuery(): QueryFunction {
	const messages = new AsyncQueue<SDKMessage>();
	const iterator = messages[Symbol.asyncIterator]();
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
		accountInfo: async () => ({
			email: "person@example.com",
			organization: "Anthropic",
			subscriptionType: "max",
		}),
	} as unknown as Query;
	return ({ prompt, options }) => {
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
}

describe("CHAT-28 the Claude account", () => {
	test("CHAT-28 account() reads the SDK's account info", async () => {
		const session = new ClaudeSession(makeDeps(accountQuery()), start());
		await session.warm();

		expect(await session.account()).toEqual({
			plan: "Max",
			loginMethod: "Claude account",
			email: "person@example.com",
		});
		await session.dispose();
	});
});
