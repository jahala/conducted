import { expect, test } from "bun:test";
import { chooseDelivery, resolveSteerFailure } from "./steering.ts";

test("a steer on an idle chat starts a new turn", () => {
	expect(
		chooseDelivery({ requested: "steer", status: "idle", capabilities: { steer: true } }),
	).toBe("new_turn");
});

test("a steer on a working chat steers only when the runner can", () => {
	expect(
		chooseDelivery({ requested: "steer", status: "working", capabilities: { steer: true } }),
	).toBe("steer");
	expect(
		chooseDelivery({ requested: "steer", status: "working", capabilities: { steer: false } }),
	).toBe("queue");
});

test("a new-turn message on a working chat is queued", () => {
	expect(
		chooseDelivery({ requested: "new_turn", status: "working", capabilities: { steer: true } }),
	).toBe("queue");
});

test("steer failures fall back as the research describes", () => {
	expect(resolveSteerFailure({ kind: "no_active_turn", sessionIdle: true })).toEqual({
		action: "new_turn",
	});
	expect(resolveSteerFailure({ kind: "no_active_turn", sessionIdle: false }).action).toBe("fail");
	expect(resolveSteerFailure({ kind: "reverted" })).toEqual({ action: "queue" });
	expect(resolveSteerFailure({ kind: "cancelled" })).toEqual({ action: "drop" });
});
