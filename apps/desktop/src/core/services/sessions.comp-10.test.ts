/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: tests for the goal calls of SessionsService over the real container: save, pause, resume
 * and clear send `/goal ...` as a steer, the two refusals, loading the chat's goal, and a
 * `goalChanged` notification.
 * Behaviour: ui-map.md 3.5 and 5.4, other-runners.md 2.1 (a `/goal` message becomes the goal call).
 * Test first: Save with empty text returns "Enter a goal first." and sends nothing.
 */
import type { CodexGoal, SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { answerSidecar, deliveredAsAsked } from "../../test/sidecar-answers.ts";

const CODEX: SessionConfig = {
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

const activeGoal: CodexGoal = { objective: "Ship the importer", status: "active" };

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

async function codexChat(
	config: Partial<SessionConfig> = {},
): Promise<{ test: TestContainer; sessionId: SessionId }> {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const session = must(
		await test.container.services.sessions.create(workspace.id, { ...CODEX, ...config }),
	);
	must(await test.container.sidecar.start());
	return { test, sessionId: session.id };
}

let opened: TestContainer | null = null;

afterEach(async () => {
	if (opened === null) return;
	await opened.container.stop();
	opened.close();
	opened = null;
});

describe("COMP-10 Codex goal calls", () => {
	it("saves a goal by sending '/goal <text>' as the chat's steer", async () => {
		const { test, sessionId } = await codexChat();
		opened = test;
		const calls = answerSidecar(test, deliveredAsAsked);

		const result = await test.container.actions.sessions.goal.set(
			sessionId,
			"  Ship the importer  ",
		);

		expect(result).toEqual({ ok: true, value: undefined });
		const sends = calls.filter((call) => call.method === "sendMessage");
		expect(sends.map((call) => call.params.text)).toEqual(["/goal Ship the importer"]);
		expect(sends[0]?.params.sessionId).toBe(sessionId);
	});

	it("refuses empty text with 'Enter a goal first.' and sends nothing", async () => {
		const { test, sessionId } = await codexChat();
		opened = test;
		const calls = answerSidecar(test, deliveredAsAsked);

		const result = await test.container.actions.sessions.goal.set(sessionId, "   ");

		expect(result).toMatchObject({
			ok: false,
			error: { code: "goal_empty", message: "Enter a goal first." },
		});
		expect(calls).toHaveLength(0);
	});

	it("refuses a chat that cannot do goals with Conductor's message", async () => {
		const { test, sessionId } = await codexChat({ agent: "claude", model: "default" });
		opened = test;
		const calls = answerSidecar(test, deliveredAsAsked);

		const set = await test.container.actions.sessions.goal.set(sessionId, "Ship it");
		const paused = await test.container.actions.sessions.goal.change(sessionId, "pause");

		for (const result of [set, paused]) {
			expect(result).toMatchObject({
				ok: false,
				error: {
					code: "goal_unavailable",
					message: "Codex goals are not available in this chat.",
				},
			});
		}
		expect(calls).toHaveLength(0);
	});

	it("pauses, resumes and clears the goal with '/goal pause', '/goal resume' and '/goal clear'", async () => {
		const { test, sessionId } = await codexChat();
		opened = test;
		const calls = answerSidecar(test, deliveredAsAsked);
		const goal = test.container.actions.sessions.goal;

		expect((await goal.change(sessionId, "pause")).ok).toBe(true);
		expect((await goal.change(sessionId, "resume")).ok).toBe(true);
		expect((await goal.change(sessionId, "clear")).ok).toBe(true);

		expect(
			calls.filter((call) => call.method === "sendMessage").map((call) => call.params.text),
		).toEqual(["/goal pause", "/goal resume", "/goal clear"]);
	});
});

describe("COMP-10 loading a goal", () => {
	it("reads the goal of a chat with a Codex thread, warming its agent first", async () => {
		const { test, sessionId } = await codexChat();
		opened = test;
		const sessions = test.container.services.sessions;
		must(await sessions.setAgentSessionId(sessionId, "thread-1"));
		const calls = answerSidecar(test, (call) =>
			call.method === "getGoal" ? { goal: activeGoal } : {},
		);

		must(await sessions.loadGoal(sessionId));

		expect(calls.map((call) => call.method)).toEqual(["warmAgent", "getGoal"]);
		expect(sessions.chatView(sessionId)?.goal).toEqual(activeGoal);
	});

	it("does not start the agent of a chat that has no Codex thread yet", async () => {
		const { test, sessionId } = await codexChat();
		opened = test;
		const calls = answerSidecar(test, () => ({ goal: activeGoal }));

		must(await test.container.services.sessions.loadGoal(sessionId));

		expect(calls).toHaveLength(0);
		expect(test.container.services.sessions.chatView(sessionId)?.goal).toBeNull();
	});

	it("lets only the newest read change the goal", async () => {
		const { test, sessionId } = await codexChat();
		opened = test;
		const sessions = test.container.services.sessions;
		must(await sessions.setAgentSessionId(sessionId, "thread-1"));
		const reads: ((goal: CodexGoal) => void)[] = [];
		answerSidecar(test, (call) =>
			call.method === "getGoal"
				? new Promise((resolve) => reads.push((goal) => resolve({ goal })))
				: {},
		);

		const first = sessions.loadGoal(sessionId);
		await expect.poll(() => reads.length).toBe(1);
		const second = sessions.loadGoal(sessionId);
		await expect.poll(() => reads.length).toBe(2);
		const newer: CodexGoal = { objective: "The newer goal", status: "active" };
		reads[1]?.(newer);
		await second;
		reads[0]?.({ objective: "The older goal", status: "active" });
		await first;

		expect(sessions.chatView(sessionId)?.goal).toEqual(newer);
	});

	it("shows a goal change the sidecar reports, over a read still on its way", async () => {
		const { test, sessionId } = await codexChat();
		opened = test;
		const sessions = test.container.services.sessions;
		must(await sessions.setAgentSessionId(sessionId, "thread-1"));
		const reads: ((goal: CodexGoal) => void)[] = [];
		answerSidecar(test, (call) =>
			call.method === "getGoal"
				? new Promise((resolve) => reads.push((goal) => resolve({ goal })))
				: {},
		);

		const read = sessions.loadGoal(sessionId);
		await expect.poll(() => reads.length).toBe(1);
		test.memory.controls.emitSidecarLine(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "goalChanged",
				params: { sessionId, goal: activeGoal },
			}),
		);
		await expect.poll(() => sessions.chatView(sessionId)?.goal).toEqual(activeGoal);
		reads[0]?.({ objective: "A stale goal", status: "paused" });
		await read;

		expect(sessions.chatView(sessionId)?.goal).toEqual(activeGoal);
		test.memory.controls.emitSidecarLine(
			JSON.stringify({ jsonrpc: "2.0", method: "goalChanged", params: { sessionId, goal: null } }),
		);
		await expect.poll(() => sessions.chatView(sessionId)?.goal).toBeNull();
	});
});
