/**
 * @feature AGENT-13 Codex goals: set, pause, resume, clear
 * Owns: tests that the chat's goal calls use its thread, and that the thread's goal notifications
 * are forwarded to the app.
 * Test first: a goal call starts the thread, and a server goal update reaches onGoalEvent.
 */
import { describe, expect, test } from "bun:test";
import type { SessionConfig } from "@conducted/protocol";
import {
	type AppError,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { createLogger } from "../../logging/logger.ts";
import { FakeChild, type JsonRpcMessage } from "../../test-support/fake-child.ts";
import type { StartOptions } from "../runner.ts";
import { JsonRpcCodexClient } from "./app-server-client.ts";
import { CodexSession } from "./codex-session.ts";
import { CodexTranslator } from "./translate.ts";

const config: SessionConfig = {
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

function goalChild(): FakeChild {
	const child = new FakeChild();
	const answer = (message: JsonRpcMessage, result: unknown): void => {
		queueMicrotask(() => child.emit({ jsonrpc: "2.0", id: message.id, result }));
	};
	child.onWrite = (message) => {
		if (message.id === undefined) return;
		const params = (message.params ?? {}) as Record<string, unknown>;
		if (message.method === "initialize") answer(message, { serverVersion: "0.154.0" });
		else if (message.method === "thread/start") {
			answer(message, { thread: { id: "thread-1" }, model: "gpt-5" });
		} else if (message.method === "thread/goal/set") {
			answer(message, {
				goal: {
					threadId: "thread-1",
					objective: params.objective ?? "ship",
					status: params.status ?? "active",
					tokenBudget: null,
					tokensUsed: 0,
				},
			});
		} else if (message.method === "thread/goal/clear") {
			answer(message, { cleared: true });
		} else answer(message, {});
	};
	return child;
}

function makeSession(child: FakeChild, events: unknown[]): CodexSession {
	const logger = createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test:goals-session",
	});
	const start: StartOptions = {
		sessionId: "session-1" as SessionId,
		config,
		workspace: {
			workspaceId: "workspace-1" as WorkspaceId,
			workspaceName: "one",
			workspacePath: "/workspace",
			repoRootPath: "/repo",
			targetBranch: "origin/main",
			placeholderBranch: false,
			port: 4310,
		},
		env: {},
	};
	return new CodexSession(
		{
			connectClient: async () => {
				const client = new JsonRpcCodexClient({
					spawn: async (): Promise<Result<FakeChild, AppError>> => ok(child),
					codexPath: "codex",
					cwd: "/workspace",
					env: {},
					extraArgs: [],
					clientName: "conducted",
					clientVersion: "0.1.0",
					logger,
				});
				const connected = await client.connect();
				if (!connected.ok) throw connected.error;
				return client;
			},
			translator: new CodexTranslator({ logger }),
			logger,
			random: () => 0,
			sleep: async () => {},
			onGoalEvent: (event) => events.push(event),
		},
		start,
	);
}

describe("AGENT-13 Codex session goals", () => {
	test("AGENT-13 the goal calls start the chat's thread and use its id", async () => {
		const child = goalChild();
		const session = makeSession(child, []);

		const found = await session.goalClient();

		expect(found.ok).toBe(true);
		if (!found.ok) return;
		expect(found.value.threadId).toBe("thread-1");
		const set = await found.value.goals.set(found.value.threadId, "ship the importer");
		expect(set.ok).toBe(true);
		expect(child.lines.find((line) => line.method === "thread/start")).toBeDefined();
		expect(child.lines.find((line) => line.method === "thread/goal/set")?.params).toEqual({
			threadId: "thread-1",
			objective: "ship the importer",
		});
	});

	test("AGENT-13 server goal updates and clears reach onGoalEvent", async () => {
		const child = goalChild();
		const events: unknown[] = [];
		const session = makeSession(child, events);
		await session.goalClient();

		const updated = { threadId: "thread-1", turnId: null, goal: {} };
		const cleared = { threadId: "thread-1" };
		child.emit({ jsonrpc: "2.0", method: "thread/goal/updated", params: updated });
		child.emit({ jsonrpc: "2.0", method: "thread/goal/cleared", params: cleared });

		expect(events).toEqual([
			{ notification: "updated", params: updated },
			{ notification: "cleared", params: cleared },
		]);
	});
});
