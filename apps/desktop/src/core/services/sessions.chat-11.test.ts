/**
 * Tests for CHAT-11: a closed Codex request marks the card as timed out without hiding it.
 */
import type { InteractionRequest } from "@conducted/protocol";
import { type InteractionId, ok, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

const sessionId = "s1" as SessionId;
const interactionId = "i1" as InteractionId;

const request: InteractionRequest = {
	sessionId,
	interactionId,
	interaction: {
		kind: "permission_grant",
		description: "Codex wants to read the project.",
		paths: [{ path: "/code/project", pathKind: "path", access: "read" }],
		network: false,
	},
	expiresAt: 1_000,
};

const harness = () => {
	const sidecar = {
		request: vi.fn(async () => ok(undefined)),
		notify: vi.fn(async () => ok(undefined)),
	};
	const service = new SessionsService({ sidecar } as unknown as SessionsServiceDeps);
	return { service };
};

describe("CHAT-11 interaction closed", () => {
	it("keeps a timed-out card on screen and settles the agent's request as withdrawn", async () => {
		const { service } = harness();
		const pending = service.requestInteraction(request);

		service.interactionClosed({ sessionId, interactionId, reason: "timed_out" });

		expect(service.store.getState().openInteractions[sessionId]).toMatchObject({
			interactionId,
			expiresAt: 1_000,
			timedOut: true,
		});
		await expect(pending).resolves.toEqual({ kind: "withdrawn" });
	});

	it("ignores a close for an interaction the chat is not showing", () => {
		const { service } = harness();
		service.requestInteraction(request);

		service.interactionClosed({
			sessionId,
			interactionId: "i2" as InteractionId,
			reason: "timed_out",
		});

		expect(service.store.getState().openInteractions[sessionId]).toMatchObject({
			interactionId,
			timedOut: false,
		});
	});

	it("leaves the card open when the answer could not be delivered", () => {
		const { service } = harness();
		service.requestInteraction(request);

		service.interactionClosed({ sessionId, interactionId, reason: "delivery_failed" });

		expect(service.store.getState().openInteractions[sessionId]).toMatchObject({
			interactionId,
			timedOut: false,
		});
	});
});
