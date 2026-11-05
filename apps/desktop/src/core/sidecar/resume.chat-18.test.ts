// @vitest-environment node
/**
 * @feature CHAT-18 Resume after restart and reconnect
 * Behaviour: sessions.md section 8, sessions-and-chats.md "How chats are stored".
 * Test first: a chat the UI shows as working, which the sidecar reports as unknown, ends with a
 * turn_ended event with outcome "interrupted" and an idle live state.
 */
import { type Interaction, idleLiveState, type LiveState } from "@conducted/protocol";
import { appError, err, ok, type SessionId, type TurnId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { createRepositories, type Repositories } from "../db/repositories.ts";
import { sampleSession, userMessageEvent } from "../db/test-fixtures.ts";
import { SessionResume, type SessionResumeDeps } from "./resume.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const working: LiveState = { ...idleLiveState, status: "working" };

let open: TestContainer | null = null;

afterEach(() => {
	open?.close();
	open = null;
});

interface Harness {
	test: TestContainer;
	repositories: Repositories;
	sessionId: SessionId;
	sidecar: { request: ReturnType<typeof vi.fn> };
	resume: SessionResume;
}

const harness = async (
	request: (method: string, params: { sessionId: SessionId }) => Promise<unknown>,
	overrides: Partial<SessionResumeDeps["apply"]> = {},
): Promise<Harness> => {
	const test = createTestContainer();
	open = test;
	let nextId = 0;
	const repositories = createRepositories(test.database, {
		clock: { now: () => 1000 },
		ids: { uuid: () => `test-${++nextId}` },
	});
	const workspace = await seedWorkspace(test.container);
	const session = must(
		await repositories.sessions.create({
			workspaceId: workspace.id,
			title: "Restart me",
			config: sampleSession.config,
		}),
	);
	must(await repositories.sessions.setAgentSessionId(session.id, "agent-abc"));
	must(
		await repositories.sessionEvents.append(
			session.id,
			userMessageEvent("event-1", "turn-1", 900),
			900,
		),
	);
	must(await test.container.services.sessions.start());
	await test.container.services.sessions.applyLiveState(session.id, working);

	const sidecar = { request: vi.fn(request) };
	const sessions = test.container.services.sessions;
	const resume = new SessionResume({
		sidecar: sidecar as never,
		workingSessionIds: async () => [session.id],
		liveStateOf: (sessionId) => sessions.store.getState().liveStates[sessionId],
		apply: {
			adoptLiveState: (sessionId, liveState) => sessions.applyLiveState(sessionId, liveState),
			markInterrupted: (sessionId) => sessions.markInterrupted(sessionId),
			...overrides,
		},
	});
	return { test, repositories, sessionId: session.id, sidecar, resume };
};

describe("CHAT-18 resume after restart", () => {
	it("closes a working chat the sidecar lost as interrupted and idle", async () => {
		const h = await harness(async () => ok({ known: false }));

		const result = await h.resume.resume();

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.interrupted).toEqual([h.sessionId]);
		expect(result.value.adopted).toEqual([]);

		const turns = must(
			await h.repositories.sessionEvents.listByTurn(h.sessionId, "turn-1" as TurnId),
		);
		const ended = turns.filter((stored) => stored.event.type === "turn_ended");
		expect(ended).toHaveLength(1);
		expect(ended[0]?.event).toMatchObject({
			type: "turn_ended",
			turnId: "turn-1",
			outcome: "interrupted",
		});
		expect(h.test.container.services.sessions.store.getState().liveStates[h.sessionId]).toEqual(
			idleLiveState,
		);
		const stored = must(await h.repositories.sessions.get(h.sessionId));
		expect(stored?.agentSessionId).toBe("agent-abc");
	});

	it("adopts the live state the sidecar still has and shows its open interaction", async () => {
		const interaction: Interaction = {
			kind: "question",
			questions: [{ question: "Which branch?", options: [], multiSelect: false }],
		};
		const liveState: LiveState = {
			...working,
			pendingSteerIds: ["m1"] as never[],
			openInteraction: { interactionId: "i1" as never, interaction, since: 900 },
		};
		const h = await harness(async () => ok({ known: true, liveState }));

		const result = await h.resume.resume();

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.adopted).toEqual([h.sessionId]);
		expect(result.value.interrupted).toEqual([]);
		const state = h.test.container.services.sessions.store.getState();
		expect(state.liveStates[h.sessionId]).toEqual(liveState);
		expect(state.openInteractions[h.sessionId]).toEqual({
			interactionId: "i1",
			interaction,
			expiresAt: null,
			timedOut: false,
		});
		const turns = must(
			await h.repositories.sessionEvents.listByTurn(h.sessionId, "turn-1" as TurnId),
		);
		expect(turns.some((stored) => stored.event.type === "turn_ended")).toBe(false);
	});

	it("reports a failed status request without guessing that the turn was interrupted", async () => {
		const h = await harness(async () => err(appError("rpc_timeout", "The sidecar did not answer")));

		const result = await h.resume.resume();

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.failed).toEqual([
			{ sessionId: h.sessionId, message: "The sidecar did not answer" },
		]);
		expect(result.value.interrupted).toEqual([]);
		const turns = must(
			await h.repositories.sessionEvents.listByTurn(h.sessionId, "turn-1" as TurnId),
		);
		expect(turns.some((stored) => stored.event.type === "turn_ended")).toBe(false);
	});

	it("collapses two resume runs at once into one", async () => {
		let release: ((value: unknown) => void) | undefined;
		const h = await harness(
			async () =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);

		const first = h.resume.resume();
		const second = h.resume.resume();
		await Promise.resolve();
		expect(h.sidecar.request).toHaveBeenCalledTimes(1);

		release?.(ok({ known: false }));
		await Promise.all([first, second]);
		expect(h.sidecar.request).toHaveBeenCalledTimes(1);
	});

	it("drops a status answer that a live-state notification made stale", async () => {
		let release: ((value: unknown) => void) | undefined;
		const h = await harness(
			async () =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const sessions = h.test.container.services.sessions;

		const running = h.resume.resume();
		await vi.waitFor(() => expect(h.sidecar.request).toHaveBeenCalledTimes(1));

		const newer: LiveState = { ...idleLiveState };
		await sessions.applyLiveState(h.sessionId, newer);
		release?.(ok({ known: false }));

		const result = await running;

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.interrupted).toEqual([]);
		expect(sessions.store.getState().liveStates[h.sessionId]).toEqual(newer);
		const turns = must(
			await h.repositories.sessionEvents.listByTurn(h.sessionId, "turn-1" as TurnId),
		);
		expect(turns.some((stored) => stored.event.type === "turn_ended")).toBe(false);
	});

	it("reports a failed live-state write instead of calling the chat adopted", async () => {
		const h = await harness(async () => ok({ known: true, liveState: working }), {
			adoptLiveState: async () => err(appError("db.failed", "The live state was not stored")),
		});

		const result = await h.resume.resume();

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.adopted).toEqual([]);
		expect(result.value.failed).toEqual([
			{ sessionId: h.sessionId, message: "The live state was not stored" },
		]);
	});
	it("runs again after a reconnect that came while a run was waiting on the old connection", async () => {
		const answers: ((value: unknown) => void)[] = [];
		const h = await harness(
			() =>
				new Promise((resolve) => {
					answers.push(resolve);
				}),
		);

		const first = h.resume.resume();
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		const second = h.resume.resumeAfterReconnect();
		const third = h.resume.resumeAfterReconnect();
		expect(h.sidecar.request).toHaveBeenCalledTimes(1);

		// The old connection died: its answer is a failure and the chat stays working.
		answers[0]?.(err(appError("sidecar_restarted", "The sidecar restarted before it answered.")));
		const firstReport = await first;
		expect(firstReport.ok && firstReport.value.failed).toHaveLength(1);

		await vi.waitFor(() => expect(answers).toHaveLength(2));
		answers[1]?.(ok({ known: false }));
		const [secondReport, thirdReport] = await Promise.all([second, third]);

		expect(h.sidecar.request).toHaveBeenCalledTimes(2);
		expect(secondReport.ok && secondReport.value.interrupted).toEqual([h.sessionId]);
		expect(thirdReport).toBe(secondReport);
	});

	it("starts a run at once after a reconnect when none is in flight", async () => {
		const h = await harness(async () => ok({ known: false }));

		const report = await h.resume.resumeAfterReconnect();

		expect(report.ok && report.value.interrupted).toEqual([h.sessionId]);
		expect(h.sidecar.request).toHaveBeenCalledTimes(1);
	});
});
