/**
 * @feature SIDE-20 Tell the app when the agent changes a chat's mode
 * Behaviour: sessions.md 5 step 5, claude-runner.md 2.1 and 3.5 (an agent that enters plan mode by
 * itself, or leaves it after an approved plan, sends the app the new config).
 * Test first: an agentConfigChanged notification reaches the port and stores the new config.
 */
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { sampleSession } from "../db/test-fixtures.ts";
import { createSidecarNotificationHandlers, type SidecarHandlerPorts } from "./handlers.ts";

const sessionId = "s1" as SessionId;
const params = {
	sessionId,
	config: { ...sampleSession.config, planMode: true },
	reason: "entered_plan_mode" as const,
};

const ports = (overrides: Partial<SidecarHandlerPorts>): SidecarHandlerPorts =>
	overrides as unknown as SidecarHandlerPorts;

describe("SIDE-20 agent config notification", () => {
	it("stores the config the agent changed", async () => {
		const setAgentConfig = vi.fn(async () => ok(undefined));
		const handlers = createSidecarNotificationHandlers(ports({ agentConfig: { setAgentConfig } }));

		await handlers.agentConfigChanged(params);

		expect(setAgentConfig).toHaveBeenCalledWith(params);
	});

	it("throws when the config could not be stored, so the tunnel logs it", async () => {
		const setAgentConfig = vi.fn(async () => err(appError("db.failed", "The write failed")));
		const handlers = createSidecarNotificationHandlers(ports({ agentConfig: { setAgentConfig } }));

		await expect(handlers.agentConfigChanged(params)).rejects.toThrow("The write failed");
	});
});
