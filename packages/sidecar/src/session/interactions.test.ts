import { describe, expect, test } from "bun:test";
import type {
	Interaction,
	InteractionAnswer,
	InteractionRequest,
	LiveState,
} from "@conducted/protocol";
import { CODEX_INTERACTION_TIMEOUT_MS, idleLiveState } from "@conducted/protocol";
import type { InteractionId, SessionId, ToolUseId } from "@conducted/shared";
import { appError } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import type { SidecarToApp } from "../rpc/types.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import { answerMatches, SessionInteractionBroker } from "./interactions.ts";
import { LiveStateStore } from "./live-state.ts";

const sid = (value: string) => value as SessionId;
const iid = (value: string) => value as InteractionId;

const question: Interaction = {
	kind: "question",
	questions: [
		{ question: "Which one?", options: [{ label: "A" }, { label: "B" }], multiSelect: false },
	],
};
const plan: Interaction = { kind: "plan_approval", plan: "Change one file" };
const approval: Interaction = {
	kind: "tool_approval",
	toolUseId: "tool-1" as ToolUseId,
	toolName: "Bash",
	input: { command: "ls" },
};
const permission: Interaction = {
	kind: "permission_grant",
	description: "Network access",
	paths: [],
	network: true,
};
const form: Interaction = {
	kind: "mcp_form",
	server: "files",
	message: "Pick a folder",
	schema: {},
};

class TestLiveState extends LiveStateStore {
	private readonly states = new Map<SessionId, LiveState>();

	constructor(app: SidecarToApp) {
		super({ app, flushed: async () => {} });
	}

	override get(sessionId: SessionId): LiveState {
		return this.states.get(sessionId) ?? idleLiveState;
	}

	override async update(
		sessionId: SessionId,
		reducer: (state: LiveState) => LiveState,
	): Promise<void> {
		this.states.set(sessionId, reducer(this.get(sessionId)));
	}

	override drop(sessionId: SessionId): void {
		this.states.delete(sessionId);
	}
}

function harness() {
	const app = new FakeApp({ holdRequests: true });
	const liveState = new TestLiveState(app);
	let nextId = 0;
	const broker = new SessionInteractionBroker({
		app,
		liveState,
		clock: { now: () => 1_000 },
		ids: { uuid: () => `interaction-${++nextId}` },
		logger: createLogger({
			sink: () => {},
			clock: { now: () => 1_000 },
			level: "error",
			scope: "test",
		}),
	});
	return { app, liveState, broker };
}

async function until(check: () => boolean, description: string): Promise<void> {
	const deadline = Date.now() + 2000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}

function requestAt(app: FakeApp, index: number): InteractionRequest | undefined {
	return app.requests[index]?.params as InteractionRequest | undefined;
}

describe("SIDE-11 interactions", () => {
	test("SIDE-11 an answer must have the kind of its interaction, and withdrawn fits all", () => {
		expect(answerMatches(plan, { kind: "plan_approval", approved: true })).toBe(true);
		expect(answerMatches(plan, { kind: "question", answers: [] })).toBe(false);
		expect(answerMatches(plan, { kind: "withdrawn" })).toBe(true);
	});

	test("SIDE-11 sends one open interaction, publishes it, and resolves with the answer", async () => {
		const h = harness();
		const session = sid("session-1");
		const answer = h.broker.open(session, question);
		await until(() => h.app.requests.length === 1, "the question request");

		expect(h.app.requests[0]?.method).toBe("requestInteraction");
		expect(h.app.requests[0]?.params).toMatchObject({
			sessionId: session,
			interactionId: iid("interaction-1"),
			interaction: question,
		});
		await until(
			() => h.liveState.get(session).openInteraction !== undefined,
			"the open interaction in live state",
		);
		expect(h.liveState.get(session).openInteraction?.interaction).toEqual(question);

		expect(
			h.broker.answer(session, iid("interaction-1"), { kind: "question", answers: [["A"]] }),
		).toEqual({ accepted: true, superseded: false });
		expect(await answer).toEqual({ kind: "question", answers: [["A"]] });
		await until(
			() => h.liveState.get(session).openInteraction === undefined,
			"live state to clear",
		);
		expect(h.broker.openRequest(session)).toBeUndefined();
	});

	test("SIDE-11 opens a second interaction only after the first is answered", async () => {
		const h = harness();
		const session = sid("session-1");
		const first = h.broker.open(session, question);
		const second = h.broker.open(session, plan);
		await until(() => h.app.requests.length === 1, "the first request only");
		expect(requestAt(h.app, 0)?.interaction).toEqual(question);

		h.broker.answer(session, iid("interaction-1"), { kind: "question", answers: [["A"]] });
		await until(() => h.app.requests.length === 2, "the second request to open");
		expect(requestAt(h.app, 1)?.interaction).toEqual(plan);
		await until(
			() => h.liveState.get(session).openInteraction?.interactionId === iid("interaction-2"),
			"live state to show the second interaction",
		);

		expect(
			h.broker.answer(session, iid("interaction-1"), { kind: "question", answers: [["A"]] }),
		).toEqual({ accepted: false, superseded: true });

		expect(
			h.broker.answer(session, iid("interaction-2"), { kind: "plan_approval", approved: true }),
		).toEqual({ accepted: true, superseded: false });
		expect(await first).toEqual({ kind: "question", answers: [["A"]] });
		expect(await second).toEqual({ kind: "plan_approval", approved: true });
	});

	test("SIDE-11 withdraws the open and waiting interactions", async () => {
		const h = harness();
		const session = sid("session-1");
		const first = h.broker.open(session, question);
		const second = h.broker.open(session, plan);
		await until(() => h.app.requests.length === 1, "the first request only");

		h.broker.withdrawAll(session);
		expect(await first).toEqual({ kind: "withdrawn" });
		expect(await second).toEqual({
			kind: "plan_approval",
			approved: false,
			feedback: "Plan not approved",
		});
		expect(h.broker.openRequest(session)).toBeUndefined();
		expect(
			h.broker.answer(session, iid("interaction-1"), { kind: "question", answers: [] }),
		).toEqual({ accepted: false, superseded: true });
		await until(
			() => h.liveState.get(session).openInteraction === undefined,
			"live state to clear",
		);
	});

	test("SIDE-11 cancelling a plan review denies with the text Plan not approved", async () => {
		const h = harness();
		const session = sid("session-1");
		const answer = h.broker.open(session, plan);
		await until(() => h.app.requests.length === 1, "the plan request");

		h.broker.withdrawAll(session);

		expect(await answer).toEqual({
			kind: "plan_approval",
			approved: false,
			feedback: "Plan not approved",
		});
	});

	test("SIDE-11 refuses an answer of the wrong kind and keeps the interaction open", async () => {
		const h = harness();
		const session = sid("session-1");
		const answer = h.broker.open(session, plan);
		await until(() => h.app.requests.length === 1, "the plan request");

		expect(
			h.broker.answer(session, iid("interaction-1"), { kind: "question", answers: [] }),
		).toEqual({ accepted: false, superseded: false });
		expect(h.broker.openRequest(session)?.interactionId).toBe(iid("interaction-1"));

		h.broker.answer(session, iid("interaction-1"), { kind: "plan_approval", approved: false });
		expect(await answer).toEqual({ kind: "plan_approval", approved: false });
	});

	test("SIDE-11 resolves safely when the app is not connected", async () => {
		const cases: { interaction: Interaction; expected: InteractionAnswer }[] = [
			{
				interaction: plan,
				expected: {
					kind: "plan_approval",
					approved: false,
					feedback: "The app was not connected",
				},
			},
			{ interaction: question, expected: { kind: "question", answers: [] } },
			{ interaction: approval, expected: { kind: "withdrawn" } },
			{ interaction: permission, expected: { kind: "permission_grant", granted: false } },
			{ interaction: form, expected: { kind: "mcp_form", action: "decline" } },
		];

		for (const testCase of cases) {
			const h = harness();
			const session = sid("session-1");
			const answer = h.broker.open(session, testCase.interaction);
			await until(() => h.app.requests.length === 1, "the request");
			h.app.failNext(appError("app_not_connected", "The app is not connected"));
			expect(await answer).toEqual(testCase.expected);
		}
	});

	test("SIDE-11 resolves a thrown request with the safe answer", async () => {
		const h = harness();
		const session = sid("session-1");
		const answer = h.broker.open(session, question);
		await until(() => h.app.requests.length === 1, "the request");
		h.app.rejectNext(new Error("socket closed"));
		expect(await answer).toEqual({ kind: "question", answers: [] });
	});

	test("SIDE-11 resends only the open interaction after a reconnect", async () => {
		const h = harness();
		const session = sid("session-1");
		const first = h.broker.open(session, question);
		const second = h.broker.open(session, plan);
		await until(() => h.app.requests.length === 1, "the first request only");

		expect(h.broker.openRequest(session)?.interactionId).toBe(iid("interaction-1"));
		expect(h.broker.openRequest(session)?.interaction).toEqual(question);

		h.broker.answer(session, iid("interaction-1"), { kind: "question", answers: [["A"]] });
		await until(() => h.app.requests.length === 2, "the queued interaction");
		expect(h.broker.openRequest(session)?.interactionId).toBe(iid("interaction-2"));

		h.broker.withdrawAll(session);
		await first;
		await second;
		expect(h.broker.openRequest(session)).toBeUndefined();
	});

	test("SIDE-11 gives Codex permissions and MCP forms an expiry and questions none", async () => {
		const h = harness();
		const session = sid("session-1");
		const permissionAnswer = h.broker.open(session, permission);
		await until(() => h.app.requests.length === 1, "the permission request");
		expect(requestAt(h.app, 0)?.expiresAt).toBe(1_000 + CODEX_INTERACTION_TIMEOUT_MS);
		h.broker.withdrawAll(session);
		await permissionAnswer;

		const withQuestion = harness();
		const questionAnswer = withQuestion.broker.open(session, question);
		await until(() => withQuestion.app.requests.length === 1, "the question request");
		expect(requestAt(withQuestion.app, 0)?.expiresAt).toBeUndefined();
		withQuestion.broker.withdrawAll(session);
		await questionAnswer;
	});

	test("SIDE-11 keeps one open per chat without blocking another chat", async () => {
		const h = harness();
		const first = h.broker.open(sid("session-1"), question);
		const second = h.broker.open(sid("session-2"), plan);
		await until(() => h.app.requests.length === 2, "both chats' requests");
		expect(requestAt(h.app, 0)?.sessionId).toBe(sid("session-1"));
		expect(requestAt(h.app, 1)?.sessionId).toBe(sid("session-2"));

		h.broker.withdrawAll(sid("session-1"));
		h.broker.withdrawAll(sid("session-2"));
		expect(await first).toEqual({ kind: "withdrawn" });
		expect(await second).toEqual({
			kind: "plan_approval",
			approved: false,
			feedback: "Plan not approved",
		});
	});
});
