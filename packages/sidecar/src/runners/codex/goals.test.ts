/**
 * @feature AGENT-13 Codex goals: set, pause, resume, clear
 * Owns: tests for reading `/goal` messages, mapping the app server's goal shape and statuses,
 * the goal calls, and the controller that reports each change to the app.
 * Test first: `parseGoalCommand("/goal pause")` returns the pause action.
 */
import { describe, expect, test } from "bun:test";
import type { CodexGoal } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result, type SessionId } from "@conducted/shared";
import { createLogger, type LogRecord } from "../../logging/logger.ts";
import {
	type CodexGoalClient,
	CodexGoalController,
	CodexThreadGoalClient,
	type GoalRpc,
	parseGoalCommand,
} from "./goals.ts";

const SESSION = "session-1" as SessionId;

function logger(records: LogRecord[] = []) {
	return createLogger({
		sink: (record) => records.push(record),
		clock: { now: () => 0 },
		level: "warn",
		scope: "test:goals",
	});
}

interface Call {
	method: string;
	params: unknown;
}

function rpc(answers: Record<string, unknown>): { rpc: GoalRpc; calls: Call[] } {
	const calls: Call[] = [];
	return {
		calls,
		rpc: {
			request: async <T>(method: string, params: unknown): Promise<Result<T, AppError>> => {
				calls.push({ method, params });
				if (method in answers) return ok(answers[method] as T);
				return err(appError("goal_test_missing", `No answer for ${method}`));
			},
		},
	};
}

const serverGoal = {
	threadId: "thread-1",
	objective: "ship the importer",
	status: "active",
	tokenBudget: 20_000,
	tokensUsed: 120,
	timeUsedSeconds: 60,
	createdAt: 1,
	updatedAt: 2,
};

function goalClient(overrides: Partial<CodexGoalClient> = {}): CodexGoalClient {
	const goal: CodexGoal = {
		objective: "ship the importer",
		status: "active",
		tokenBudget: 20_000,
		tokensUsed: 120,
	};
	return {
		get: async () => ok(goal),
		set: async () => ok(goal),
		pause: async () => ok({ ...goal, status: "paused" }),
		resume: async () => ok(goal),
		clear: async () => ok(undefined),
		...overrides,
	};
}

describe("AGENT-13 parseGoalCommand", () => {
	test("AGENT-13 /goal pause is the pause action", () => {
		expect(parseGoalCommand("/goal pause")).toEqual(ok({ action: "pause" }));
	});

	test("AGENT-13 /goal resume and /goal clear are their actions", () => {
		expect(parseGoalCommand("/goal resume")).toEqual(ok({ action: "resume" }));
		expect(parseGoalCommand("/goal clear")).toEqual(ok({ action: "clear" }));
	});

	test("AGENT-13 /goal with an objective is a set action that keeps the whole objective", () => {
		expect(parseGoalCommand("/goal ship the importer")).toEqual(
			ok({ action: "set", objective: "ship the importer" }),
		);
	});

	test("AGENT-13 the action word wins over an objective that starts with the same word", () => {
		expect(parseGoalCommand("/goal pause the old goal")).toEqual(ok({ action: "pause" }));
	});

	test("AGENT-13 a message that does not start with the /goal word is not a goal command", () => {
		expect(parseGoalCommand("please /goal pause")).toEqual(ok(null));
		expect(parseGoalCommand("/goalkeeper ship")).toEqual(ok(null));
	});

	test("AGENT-13 /goal with no objective is a usage error", () => {
		const parsed = parseGoalCommand("/goal");
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error.code).toBe("goal_usage");
	});
});

describe("AGENT-13 Codex thread goal calls", () => {
	test("AGENT-13 set sends thread/goal/set with the objective and token budget", async () => {
		const { rpc: port, calls } = rpc({ "thread/goal/set": { goal: serverGoal } });
		const client = new CodexThreadGoalClient({ rpc: port, logger: logger() });

		const result = await client.set("thread-1", "ship the importer", 20_000);

		expect(result).toEqual(
			ok({
				objective: "ship the importer",
				status: "active",
				tokenBudget: 20_000,
				tokensUsed: 120,
			}),
		);
		expect(calls).toEqual([
			{
				method: "thread/goal/set",
				params: { threadId: "thread-1", objective: "ship the importer", tokenBudget: 20_000 },
			},
		]);
	});

	test("AGENT-13 pause and resume set the server status", async () => {
		const { rpc: port, calls } = rpc({
			"thread/goal/set": { goal: { ...serverGoal, status: "paused" } },
		});
		const client = new CodexThreadGoalClient({ rpc: port, logger: logger() });

		await client.pause("thread-1");
		await client.resume("thread-1");

		expect(calls).toEqual([
			{ method: "thread/goal/set", params: { threadId: "thread-1", status: "paused" } },
			{ method: "thread/goal/set", params: { threadId: "thread-1", status: "active" } },
		]);
	});

	test("AGENT-13 clear sends thread/goal/clear", async () => {
		const { rpc: port, calls } = rpc({ "thread/goal/clear": { cleared: true } });
		const client = new CodexThreadGoalClient({ rpc: port, logger: logger() });

		expect(await client.clear("thread-1")).toEqual(ok(undefined));
		expect(calls).toEqual([{ method: "thread/goal/clear", params: { threadId: "thread-1" } }]);
	});

	test("AGENT-13 get sends thread/goal/get and reads a missing goal as null", async () => {
		const { rpc: port, calls } = rpc({ "thread/goal/get": { goal: null } });
		const client = new CodexThreadGoalClient({ rpc: port, logger: logger() });

		expect(await client.get("thread-1")).toEqual(ok(null));
		expect(calls).toEqual([{ method: "thread/goal/get", params: { threadId: "thread-1" } }]);
	});

	test("AGENT-13 usageLimited and budgetLimited map to the protocol's status names", async () => {
		const records: LogRecord[] = [];
		const { rpc: port } = rpc({
			"thread/goal/get": { goal: { ...serverGoal, status: "usageLimited" } },
		});
		const client = new CodexThreadGoalClient({ rpc: port, logger: logger(records) });

		const limited = await client.get("thread-1");
		expect(limited.ok && limited.value?.status).toBe("usage_limited");

		const budget = new CodexThreadGoalClient({
			rpc: rpc({
				"thread/goal/get": { goal: { ...serverGoal, status: "budgetLimited" } },
			}).rpc,
			logger: logger(records),
		});
		const budgeted = await budget.get("thread-1");
		expect(budgeted.ok && budgeted.value?.status).toBe("budget_limited");
	});

	test("AGENT-13 a status we do not know is kept as blocked and logged", async () => {
		const records: LogRecord[] = [];
		const { rpc: port } = rpc({
			"thread/goal/get": { goal: { ...serverGoal, status: "walking" } },
		});
		const client = new CodexThreadGoalClient({ rpc: port, logger: logger(records) });

		const got = await client.get("thread-1");

		expect(got.ok && got.value?.status).toBe("blocked");
		expect(records.some((record) => record.level === "warn")).toBe(true);
	});
});

describe("AGENT-13 Codex goal controller", () => {
	test("AGENT-13 get reads the thread's goal through the chat's client and releases it", async () => {
		const released: string[] = [];
		const asked: string[] = [];
		const controller = new CodexGoalController({
			clientFor: async () =>
				ok({
					threadId: "thread-1",
					goals: goalClient({
						get: async (threadId) => {
							asked.push(threadId);
							return ok(null);
						},
					}),
					release: () => released.push("once"),
				}),
			announce: () => {},
			logger: logger(),
		});

		expect(await controller.get(SESSION)).toEqual(ok(null));
		expect(asked).toEqual(["thread-1"]);
		expect(released).toEqual(["once"]);
	});

	test("AGENT-13 set and pause report the new goal, and clear reports none", async () => {
		const announced: (CodexGoal | null)[] = [];
		const controller = new CodexGoalController({
			clientFor: async () => ok({ threadId: "thread-1", goals: goalClient(), release: () => {} }),
			announce: (_sessionId, goal) => announced.push(goal),
			logger: logger(),
		});

		await controller.set(SESSION, "ship the importer", 20_000);
		await controller.change(SESSION, "pause");
		await controller.change(SESSION, "clear");

		expect(announced.map((goal) => goal?.status ?? null)).toEqual(["active", "paused", null]);
	});

	test("AGENT-13 a client error is passed through and nothing is announced", async () => {
		const announced: (CodexGoal | null)[] = [];
		const controller = new CodexGoalController({
			clientFor: async () => err(appError("session_unknown", "No such chat")),
			announce: (_sessionId, goal) => announced.push(goal),
			logger: logger(),
		});

		const result = await controller.set(SESSION, "ship the importer");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("session_unknown");
		expect(announced).toEqual([]);
	});

	test("AGENT-13 server goal events report updates and clears", () => {
		const announced: (CodexGoal | null)[] = [];
		const controller = new CodexGoalController({
			clientFor: async () => ok({ threadId: "thread-1", goals: goalClient(), release: () => {} }),
			announce: (_sessionId, goal) => announced.push(goal),
			logger: logger(),
		});

		controller.onServerGoalEvent(SESSION, {
			notification: "updated",
			params: { threadId: "thread-1", goal: serverGoal },
		});
		controller.onServerGoalEvent(SESSION, {
			notification: "cleared",
			params: { threadId: "thread-1" },
		});

		expect(announced.map((goal) => goal?.objective ?? null)).toEqual(["ship the importer", null]);
	});

	test("AGENT-13 the notification's name decides, not the payload's shape", () => {
		const announced: (CodexGoal | null)[] = [];
		const records: LogRecord[] = [];
		const controller = new CodexGoalController({
			clientFor: async () => ok({ threadId: "thread-1", goals: goalClient(), release: () => {} }),
			announce: (_sessionId, goal) => announced.push(goal),
			logger: logger(records),
		});

		// An update with a null goal, and one with a thread and no goal key, clear nothing.
		controller.onServerGoalEvent(SESSION, {
			notification: "updated",
			params: { threadId: "thread-1", goal: null },
		});
		controller.onServerGoalEvent(SESSION, {
			notification: "updated",
			params: { threadId: "thread-1" },
		});
		expect(announced).toEqual([]);
		expect(
			records.filter((record) => record.message === "Ignored a Codex goal update with no goal"),
		).toHaveLength(2);

		// A cleared notification clears, whatever its payload holds.
		controller.onServerGoalEvent(SESSION, {
			notification: "cleared",
			params: { threadId: "thread-1", goal: serverGoal },
		});
		expect(announced).toEqual([null]);
	});
});
