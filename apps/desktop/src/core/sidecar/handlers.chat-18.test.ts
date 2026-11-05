/**
 * @feature CHAT-18 Handlers for what the sidecar tells and asks the UI
 * Behaviour: sessions.md sections 5, 6 and 8, services-map.md 5A.8.3.
 * Test first: a deliverEvent request for a stored event answers persisted true, and a live state
 * notification reaches the live-state port.
 */
import { idleLiveState, type SessionEventEnvelope } from "@conducted/protocol";
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createSidecarNotificationHandlers,
	createSidecarRequestHandlers,
	type SidecarHandlerPorts,
} from "./handlers.ts";

const sessionId = "s1" as SessionId;

const envelope: SessionEventEnvelope = {
	sessionId,
	sequence: 3,
	event: {
		type: "turn_ended",
		eventId: "e1" as never,
		at: 10,
		turnId: "t1" as never,
		outcome: "interrupted",
	},
};

const ports = (overrides: Partial<SidecarHandlerPorts>): SidecarHandlerPorts =>
	overrides as unknown as SidecarHandlerPorts;

describe("CHAT-18 sidecar handlers", () => {
	it("answers persisted true for a deliverEvent the ingest stored", async () => {
		const ingest = vi.fn(async () => ok({ stored: true, idx: 4 }));
		const handlers = createSidecarRequestHandlers(ports({ ingest: { ingest } }));

		const result = await handlers.deliverEvent(envelope);

		expect(ingest).toHaveBeenCalledWith(envelope);
		expect(result).toEqual({ persisted: true });
	});

	it("answers persisted false when ingest could not store the event", async () => {
		const ingest = vi.fn(async () => err(appError("db.failed", "The write failed")));
		const handlers = createSidecarRequestHandlers(ports({ ingest: { ingest } }));

		const result = await handlers.deliverEvent(envelope);

		expect(result).toEqual({ persisted: false });
	});

	it("shows the live state the sidecar reports", async () => {
		const setLiveState = vi.fn(async () => ok(undefined));
		const handlers = createSidecarNotificationHandlers(
			ports({ liveState: { setLiveState } as never }),
		);
		const params = { sessionId, liveState: idleLiveState };

		await handlers.liveState(params);

		expect(setLiveState).toHaveBeenCalledWith(params);
	});

	it("throws when the live state could not be shown, so the tunnel logs it", async () => {
		const setLiveState = vi.fn(async () => err(appError("db.failed", "The write failed")));
		const handlers = createSidecarNotificationHandlers(
			ports({ liveState: { setLiveState } as never }),
		);

		await expect(handlers.liveState({ sessionId, liveState: idleLiveState })).rejects.toThrow(
			"The write failed",
		);
	});

	it("records the agent's own session id", async () => {
		const setAgentSessionId = vi.fn(async () => ok(undefined));
		const handlers = createSidecarNotificationHandlers(
			ports({ liveState: { setAgentSessionId } as never }),
		);
		const params = { sessionId, agentSessionId: "agent-42" };

		await handlers.agentSessionId(params);

		expect(setAgentSessionId).toHaveBeenCalledWith(params);
	});

	it("throws when the agent session id could not be stored, so the tunnel logs it", async () => {
		const setAgentSessionId = vi.fn(async () => err(appError("db.failed", "The write failed")));
		const handlers = createSidecarNotificationHandlers(
			ports({ liveState: { setAgentSessionId } as never }),
		);

		await expect(
			handlers.agentSessionId({ sessionId, agentSessionId: "agent-42" }),
		).rejects.toThrow("The write failed");
	});

	it("updates the agent catalog when the installed agents change", async () => {
		const setAgentInstalls = vi.fn();
		const handlers = createSidecarNotificationHandlers(
			ports({ agentCatalog: { setAgentInstalls } }),
		);
		const agents = [{ agent: "claude" as const, installed: true }];

		await handlers.agentInstallsChanged({ agents });

		expect(setAgentInstalls).toHaveBeenCalledWith({ agents });
	});

	it("passes a failed login-shell capture to the shell environment port", async () => {
		const captureFailed = vi.fn();
		const handlers = createSidecarNotificationHandlers(ports({ shellEnv: { captureFailed } }));
		const params = {
			folder: "/ws",
			kind: "timeout" as const,
			message: "The shell did not answer",
		};

		await handlers.shellEnvFailed(params);

		expect(captureFailed).toHaveBeenCalledWith(params);
	});
});
