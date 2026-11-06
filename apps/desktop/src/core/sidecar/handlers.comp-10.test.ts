/**
 * @feature COMP-10 Codex goal bar and `/goal`
 * Owns: the handler test for the `goalChanged` notification: a goal the sidecar reports reaches
 * the sessions service's goal state.
 * Behaviour: sessions.md 5 and 6 (sidecar notifications reach a service).
 * Test first: `goalChanged` hands the reported goal to its port.
 */
import type { CodexGoal } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createSidecarNotificationHandlers, type SidecarHandlerPorts } from "./handlers.ts";

const sessionId = "s1" as SessionId;
const goal: CodexGoal = { objective: "Ship the importer", status: "active" };

const ports = (overrides: Partial<SidecarHandlerPorts>): SidecarHandlerPorts =>
	overrides as unknown as SidecarHandlerPorts;

describe("COMP-10 goalChanged notification", () => {
	it("passes the reported goal to the goal port", async () => {
		const setGoal = vi.fn();
		const handlers = createSidecarNotificationHandlers(ports({ goal: { setGoal } }));

		await handlers.goalChanged({ sessionId, goal });

		expect(setGoal).toHaveBeenCalledWith({ sessionId, goal });
	});

	it("passes a cleared goal as null", async () => {
		const setGoal = vi.fn();
		const handlers = createSidecarNotificationHandlers(ports({ goal: { setGoal } }));

		await handlers.goalChanged({ sessionId, goal: null });

		expect(setGoal).toHaveBeenCalledWith({ sessionId, goal: null });
	});
});
