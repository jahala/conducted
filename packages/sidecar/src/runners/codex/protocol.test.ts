import { describe, expect, test } from "bun:test";
import { createLogger } from "../../logging/logger.ts";
import {
	CODEX_CLIENT_METHODS,
	CODEX_INITIALIZED_NOTIFICATION,
	CODEX_SERVER_NOTIFICATIONS,
	CODEX_SERVER_REQUESTS,
} from "./protocol.ts";
import { CodexTranslator } from "./translate.ts";

test("method names are unique within a table and have no spaces", () => {
	for (const table of [CODEX_CLIENT_METHODS, CODEX_SERVER_REQUESTS, CODEX_SERVER_NOTIFICATIONS]) {
		const values = Object.values(table);
		expect(new Set(values).size).toBe(values.length);
		for (const value of values) expect(value).not.toContain(" ");
	}
});

// The names below are the method names of `codex app-server` 0.154.0, read from the JSON schema
// that `codex app-server generate-json-schema` writes (ClientRequest, ServerRequest,
// ServerNotification and ClientNotification). A name that changes here is a message the real
// program no longer understands.
describe("AGENT-06 Codex wire names", () => {
	test("the requests we send are the names the real app server accepts", () => {
		expect(CODEX_CLIENT_METHODS).toEqual({
			initialize: "initialize",
			threadStart: "thread/start",
			threadResume: "thread/resume",
			threadFork: "thread/fork",
			threadRollback: "thread/rollback",
			threadCompactStart: "thread/compact/start",
			turnStart: "turn/start",
			turnSteer: "turn/steer",
			turnInterrupt: "turn/interrupt",
			modelList: "model/list",
			accountRead: "account/read",
			accountRateLimitsRead: "account/rateLimits/read",
			accountLoginStart: "account/login/start",
			accountLoginCancel: "account/login/cancel",
			mcpServerStatusList: "mcpServerStatus/list",
			skillsList: "skills/list",
			configRequirementsRead: "configRequirements/read",
		});
		expect(CODEX_INITIALIZED_NOTIFICATION).toBe("initialized");
	});

	test("the requests the server sends us, each of which needs an answer, are the real names", () => {
		expect(CODEX_SERVER_REQUESTS).toEqual({
			commandApproval: "item/commandExecution/requestApproval",
			fileChangeApproval: "item/fileChange/requestApproval",
			toolUserInput: "item/tool/requestUserInput",
			mcpElicitation: "mcpServer/elicitation/request",
			permissionsApproval: "item/permissions/requestApproval",
		});
	});

	test("the notifications the server sends us are the real names", () => {
		expect(CODEX_SERVER_NOTIFICATIONS).toEqual({
			threadStarted: "thread/started",
			turnStarted: "turn/started",
			turnCompleted: "turn/completed",
			itemStarted: "item/started",
			itemCompleted: "item/completed",
			tokenUsageUpdated: "thread/tokenUsage/updated",
			threadCompacted: "thread/compacted",
			error: "error",
			accountLoginCompleted: "account/login/completed",
		});
	});

	test("a name is never both something we send and something the server sends", () => {
		const sent = new Set<string>(Object.values(CODEX_CLIENT_METHODS));
		for (const name of [
			...Object.values(CODEX_SERVER_REQUESTS),
			...Object.values(CODEX_SERVER_NOTIFICATIONS),
		]) {
			expect(sent.has(name)).toBe(false);
		}
	});
});

describe("AGENT-06 Codex notification names reach the translator", () => {
	const translator = new CodexTranslator({
		logger: createLogger({
			sink: () => {},
			clock: { now: () => 0 },
			level: "error",
			scope: "test",
		}),
	});
	const usage = {
		totalTokens: 30,
		inputTokens: 10,
		cachedInputTokens: 0,
		cacheWriteInputTokens: 0,
		outputTokens: 20,
		reasoningOutputTokens: 0,
	};

	test("the token usage name from the table produces a usage item", () => {
		const messages = translator.translateNotification(
			CODEX_SERVER_NOTIFICATIONS.tokenUsageUpdated,
			{
				threadId: "t",
				turnId: "u",
				tokenUsage: { total: usage, last: usage, modelContextWindow: 1000 },
			},
		);

		expect(messages.flatMap((message) => message.items.map((item) => item.kind))).toEqual([
			"usage",
		]);
	});

	test("the compaction name from the table produces a compacted notice", () => {
		const messages = translator.translateNotification(CODEX_SERVER_NOTIFICATIONS.threadCompacted, {
			threadId: "t",
		});

		expect(messages.flatMap((message) => message.items)).toEqual([
			{ kind: "notice", notice: "compacted", text: "Chat history compacted" },
		]);
	});

	test("the error name from the table produces an error item that keeps willRetry", () => {
		const messages = translator.translateNotification(CODEX_SERVER_NOTIFICATIONS.error, {
			error: { message: "The model is overloaded." },
			willRetry: true,
		});

		expect(messages.flatMap((message) => message.items)).toMatchObject([
			{ kind: "error", message: "The model is overloaded.", retryable: true },
		]);
	});
});
