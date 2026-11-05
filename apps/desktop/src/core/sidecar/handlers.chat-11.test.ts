/**
 * Tests for CHAT-11: the sidecar's interactionClosed notification reaches the interactions port.
 */
import { describe, expect, it, vi } from "vitest";
import { createSidecarNotificationHandlers, type SidecarHandlerPorts } from "./handlers.ts";

describe("CHAT-11 interactionClosed handler", () => {
	it("passes a closed Codex request to the interactions port", async () => {
		const closed = vi.fn();
		const handlers = createSidecarNotificationHandlers({
			interactions: { closed },
		} as unknown as SidecarHandlerPorts);
		const params = {
			sessionId: "s1" as never,
			interactionId: "i1" as never,
			reason: "timed_out" as const,
		};

		await handlers.interactionClosed(params);

		expect(closed).toHaveBeenCalledWith(params);
	});
});
