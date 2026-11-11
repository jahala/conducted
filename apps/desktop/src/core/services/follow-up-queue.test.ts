import type { LiveState } from "@conducted/protocol";
import type { MessageId, SessionId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { agentCanSteer } from "../follow-up-queue.ts";
import type { QueuedMessage } from "../model.ts";
import { canReleaseQueue, chooseDelivery, nextToSend } from "./follow-up-queue.ts";

const row = (
	over: Partial<Omit<QueuedMessage, "id">> & { id: string; position: number },
): QueuedMessage => ({
	sessionId: "s1" as SessionId,
	text: "t",
	attachmentPaths: [],
	delivery: "queue",
	state: "waiting",
	lastError: null,
	...over,
	id: over.id as MessageId,
});

describe("nextToSend", () => {
	it("sends a steer row before an earlier queue row", () => {
		const rows = [row({ id: "a", position: 0 }), row({ id: "b", position: 1, delivery: "steer" })];
		expect(nextToSend(rows, false)?.id).toBe("b");
	});
	it("sends queue rows in position order", () => {
		const rows = [row({ id: "b", position: 2 }), row({ id: "a", position: 1 })];
		expect(nextToSend(rows, false)?.id).toBe("a");
	});
	it("releases nothing from a paused queue, but still sends steers", () => {
		const queued = [row({ id: "a", position: 0 })];
		expect(nextToSend(queued, true)).toBeNull();
		expect(
			nextToSend([...queued, row({ id: "s", position: 1, delivery: "steer" })], true)?.id,
		).toBe("s");
	});
	it("waits while one row is sending and skips failed rows", () => {
		expect(
			nextToSend(
				[row({ id: "a", position: 0, state: "sending" }), row({ id: "b", position: 1 })],
				false,
			),
		).toBeNull();
		expect(nextToSend([row({ id: "a", position: 0, state: "failed" })], false)).toBeNull();
	});
});

describe("chooseDelivery", () => {
	it("sends at once when the agent is idle", () => {
		expect(
			chooseDelivery({ mode: "queue", working: false, defaultMode: "steer", canSteer: true }),
		).toBe("send_now");
	});
	it("follows the default for auto", () => {
		expect(
			chooseDelivery({ mode: "auto", working: true, defaultMode: "queue", canSteer: true }),
		).toBe("queue");
		expect(
			chooseDelivery({ mode: "auto", working: true, defaultMode: "steer", canSteer: true }),
		).toBe("steer");
	});
	it("turns the default steer into a follow-up for agents that cannot steer", () => {
		expect(
			chooseDelivery({ mode: "auto", working: true, defaultMode: "steer", canSteer: false }),
		).toBe("queue");
		expect(
			chooseDelivery({ mode: "steer", working: true, defaultMode: "steer", canSteer: false }),
		).toBe("steer_unsupported");
	});
});

describe("agentCanSteer", () => {
	it("is false only for ACP agents", () => {
		expect(agentCanSteer({ agent: "acp" })).toBe(false);
		expect(agentCanSteer({ agent: "claude" })).toBe(true);
	});
});

describe("canReleaseQueue", () => {
	const idle: LiveState = {
		status: "idle",
		pendingSteerIds: [],
		backgroundTasks: [],
		fastModeAvailable: true,
	};
	it("needs idle, no background tasks and no open interaction", () => {
		expect(canReleaseQueue(idle)).toBe(true);
		expect(canReleaseQueue({ ...idle, status: "working" })).toBe(false);
		expect(
			canReleaseQueue({ ...idle, backgroundTasks: [{ id: "1", kind: "shell", description: "x" }] }),
		).toBe(false);
	});
});
