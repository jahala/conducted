import { expect, test } from "bun:test";
import { idleLiveState } from "@conducted/protocol";
import type { InteractionId, MessageId } from "@conducted/shared";
import {
	addPendingSteer,
	beginTurn,
	closeInteraction,
	endTurn,
	openInteraction,
	removePendingSteer,
} from "./live-state.ts";

const m = (v: string) => v as MessageId;

test("beginTurn clears the previous error and pending steers", () => {
	const before = { ...idleLiveState, error: "old", pendingSteerIds: [m("a")] };
	const after = beginTurn(before);
	expect(after.status).toBe("working");
	expect(after.error).toBeUndefined();
	expect(after.pendingSteerIds).toEqual([]);
});

test("endTurn goes idle, keeps an error when given, and drops an open interaction", () => {
	const interaction = openInteraction(
		beginTurn(idleLiveState),
		"i1" as InteractionId,
		{ kind: "plan_approval", plan: "p" },
		1,
	);
	const ended = endTurn(interaction, "agent crashed");
	expect(ended.status).toBe("idle");
	expect(ended.error).toBe("agent crashed");
	expect(ended.openInteraction).toBeUndefined();
});

test("a steer is added once and removed when consumed", () => {
	let state = addPendingSteer(idleLiveState, m("s1"));
	state = addPendingSteer(state, m("s1"));
	expect(state.pendingSteerIds).toEqual([m("s1")]);
	expect(removePendingSteer(state, m("s1")).pendingSteerIds).toEqual([]);
});

test("closeInteraction ignores a stale interaction id", () => {
	const open = openInteraction(
		idleLiveState,
		"i2" as InteractionId,
		{ kind: "plan_approval", plan: "p" },
		1,
	);
	expect(closeInteraction(open, "other" as InteractionId)).toBe(open);
	expect(closeInteraction(open, "i2" as InteractionId).openInteraction).toBeUndefined();
});
