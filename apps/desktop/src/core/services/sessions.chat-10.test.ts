/**
 * Tests for CHAT-10: the sessions service keeps one open interaction per chat, shows it, and
 * sends the user's answer to the sidecar.
 */
import type { InteractionAnswer, InteractionRequest, SessionEvent } from "@conducted/protocol";
import {
	appError,
	err,
	type InteractionId,
	ok,
	type Result,
	type SessionId,
	type ToolUseId,
} from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

const sessionId = "s1" as SessionId;

interface Call {
	method: string;
	params: Record<string, unknown>;
}

const question: InteractionRequest["interaction"] = {
	kind: "question",
	questions: [{ question: "Which database?", options: [{ label: "SQLite" }], multiSelect: false }],
};

const request = (
	interactionId: string,
	interaction: InteractionRequest["interaction"] = question,
): InteractionRequest => ({
	sessionId,
	interactionId: interactionId as InteractionId,
	interaction,
});

const harness = (reply?: (method: string) => Result<unknown>) => {
	const calls: Call[] = [];
	const sidecar = {
		request: vi.fn(async (method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			if (reply !== undefined) return reply(method);
			return method === "answerInteraction"
				? ok({ accepted: true, superseded: false })
				: ok(undefined);
		}),
		notify: vi.fn(async () => ok(undefined)),
	};
	const service = new SessionsService({ sidecar } as unknown as SessionsServiceDeps);
	return { service, calls };
};

const openInteraction = (service: SessionsService) =>
	service.store.getState().openInteractions[sessionId];

describe("CHAT-10 interactions", () => {
	it("turns auto-accept edits on when the user allows all edits for the session", async () => {
		const { service, calls } = harness((method) =>
			method === "answerInteraction" ? ok({ accepted: true, superseded: false }) : ok({}),
		);
		service.requestInteraction(
			request("i1", {
				kind: "tool_approval",
				toolName: "Edit",
				toolUseId: "t1" as ToolUseId,
				input: { file_path: "a.ts", old_string: "a", new_string: "b" },
			} as InteractionRequest["interaction"]),
		);

		const result = await service.answer(
			sessionId,
			"i1" as InteractionId,
			{
				kind: "tool_approval",
				decision: "allow_edits_for_session",
			} as InteractionAnswer,
		);

		expect(result).toEqual(ok(undefined));
		// The composer's chip reads this; the grant is also the chat's explicit choice (COMP-03).
		expect(service.store.getState().autoAcceptEdits?.[sessionId]).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(["answerInteraction", "setAutoApproveEdits"]);
	});

	it("keeps the open question for the chat and sends the answer to the sidecar", async () => {
		const { service, calls } = harness();
		const pending = service.requestInteraction(request("i1"));

		expect(openInteraction(service)).toMatchObject({ interactionId: "i1" });

		const answer: InteractionAnswer = { kind: "question", answers: [["SQLite"]] };
		const result = await service.answer(sessionId, "i1" as InteractionId, answer);

		expect(result).toEqual(ok(undefined));
		expect(calls[0]).toEqual({
			method: "answerInteraction",
			params: { sessionId, interactionId: "i1", answer },
		});
		expect(await pending).toEqual(answer);
		expect(openInteraction(service)).toBeUndefined();
	});

	it("accepts the same interaction id again after a reconnect", () => {
		const { service } = harness();
		const first = service.requestInteraction(request("i1"));
		const again = service.requestInteraction(request("i1"));

		expect(again).toBe(first);
		expect(openInteraction(service)).toMatchObject({ interactionId: "i1" });
	});

	it("withdraws the card that a newer interaction replaces", async () => {
		const { service } = harness();
		const first = service.requestInteraction(request("i1"));
		service.requestInteraction(request("i2"));

		expect(await first).toEqual({ kind: "withdrawn" });
		expect(openInteraction(service)).toMatchObject({ interactionId: "i2" });
	});

	it("treats a superseded answer as done and withdraws the card", async () => {
		const { service } = harness(() => ok({ accepted: false, superseded: true }));
		const pending = service.requestInteraction(request("i1"));

		const result = await service.answer(sessionId, "i1" as InteractionId, {
			kind: "question",
			answers: [[]],
		});

		expect(result).toEqual(ok(undefined));
		expect(await pending).toEqual({ kind: "withdrawn" });
		expect(openInteraction(service)).toBeUndefined();
	});

	it("keeps the card and reports an error when the sidecar refuses the answer", async () => {
		const { service } = harness(() => ok({ accepted: false, superseded: false }));
		service.requestInteraction(request("i1"));

		const result = await service.answer(sessionId, "i1" as InteractionId, {
			kind: "question",
			answers: [["SQLite"]],
		});

		expect(result).toMatchObject({
			ok: false,
			error: { code: "interaction_not_accepted" },
		});
		expect(openInteraction(service)).toMatchObject({ interactionId: "i1" });
	});

	it("reports whether a chat has a pending consent interaction", async () => {
		const { service } = harness();
		const approval: InteractionRequest["interaction"] = {
			kind: "tool_approval",
			toolUseId: "tu1" as ToolUseId,
			toolName: "Bash",
			input: {},
		};

		expect(service.hasPendingConsentInteraction(sessionId)).toBe(false);

		const pending = service.requestInteraction(request("i1", approval));
		expect(service.hasPendingConsentInteraction(sessionId)).toBe(true);

		await service.answer(sessionId, "i1" as InteractionId, {
			kind: "tool_approval",
			decision: "allow",
		});

		expect(service.hasPendingConsentInteraction(sessionId)).toBe(false);
		expect(await pending).toEqual({ kind: "tool_approval", decision: "allow" });
	});

	it("keeps the card when the answer cannot reach the sidecar", async () => {
		const { service } = harness(() => err(appError("sidecar_down", "The sidecar is not running.")));
		const pending = service.requestInteraction(request("i1"));

		const result = await service.answer(sessionId, "i1" as InteractionId, {
			kind: "question",
			answers: [["SQLite"]],
		});

		expect(result).toMatchObject({ ok: false, error: { code: "sidecar_down" } });
		expect(openInteraction(service)).toMatchObject({ interactionId: "i1" });

		service.applyStoredEvent(
			sessionId,
			0,
			{
				type: "turn_ended",
				eventId: "e1",
				at: 2,
				turnId: "t1",
				outcome: "cancelled",
			} as unknown as SessionEvent,
			2,
		);
		expect(await pending).toEqual({ kind: "withdrawn" });
	});

	it("closes the card when the turn ends", async () => {
		const { service } = harness();
		const pending = service.requestInteraction(request("i1"));

		service.applyStoredEvent(
			sessionId,
			0,
			{
				type: "turn_ended",
				eventId: "e1",
				at: 2,
				turnId: "t1",
				outcome: "success",
			} as unknown as SessionEvent,
			2,
		);

		expect(await pending).toEqual({ kind: "withdrawn" });
		expect(openInteraction(service)).toBeUndefined();
	});
});
