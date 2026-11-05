/**
 * @feature CHAT-03 Steer a running turn
 * Owns: the chat view's pending state for a steer the agent has not read yet.
 * Behaviour: frontend.md 5 (pendingSteerMessageIds drives the steer's pending marker),
 * sessions-and-chats.md "While the agent is working".
 * Test first: a stored steer stays pending while live state lists it, and is read once it is gone.
 */
import { idleLiveState, type LiveState, type SessionConfig } from "@conducted/protocol";
import type { EventId, MessageId, TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { buildTurns, type StoredEvent } from "./turn-builder.ts";

const config: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const live = (over: Partial<LiveState> = {}): LiveState => ({ ...idleLiveState, ...over });

const stored = (event: StoredEvent["event"], at = event.at): StoredEvent => ({
	idx: at,
	event,
	receivedAt: at,
	revertedAt: null,
});

const userMessage = (turn: string, messageId: string) =>
	stored({
		type: "user_message",
		eventId: `${messageId}-event` as EventId,
		at: 100,
		messageId: messageId as MessageId,
		turnId: turn as TurnId,
		text: "Start",
		attachmentPaths: [],
		delivery: "new_turn",
		config,
	});

const steer = (turn: string, messageId: string) =>
	stored({
		type: "user_message",
		eventId: `${messageId}-event` as EventId,
		at: 101,
		messageId: messageId as MessageId,
		turnId: turn as TurnId,
		text: "Also this",
		attachmentPaths: [],
		delivery: "steer",
		config,
	});

const must = <T>(value: T | undefined, what: string): T => {
	if (value === undefined) throw new Error(`Missing ${what}`);
	return value;
};

describe("CHAT-03 a steer stays pending until the agent reads it", () => {
	it("marks a stored steer unread while the live state still lists it", () => {
		const turns = buildTurns(
			[userMessage("turn-1", "m1"), steer("turn-1", "m2")],
			live({ status: "working", pendingSteerIds: ["m2" as MessageId] }),
		);

		expect(must(turns[0], "the turn").steers).toEqual([
			{ messageId: "m2", text: "Also this", at: 101, consumed: false },
		]);
	});

	it("marks the steer read once the live state no longer lists it", () => {
		const turns = buildTurns(
			[userMessage("turn-1", "m1"), steer("turn-1", "m2")],
			live({ status: "working" }),
		);

		expect(must(turns[0], "the turn").steers[0]?.consumed).toBe(true);
	});

	it("shows a steer that has not been stored yet as pending in the running turn", () => {
		const turns = buildTurns([userMessage("turn-1", "m1")], live({ status: "working" }), [
			{
				messageId: "m2" as MessageId,
				text: "Also this",
				at: 200,
				delivery: "steer",
			},
		]);

		expect(turns).toHaveLength(1);
		expect(must(turns[0], "the turn").steers).toEqual([
			{ messageId: "m2", text: "Also this", at: 200, consumed: false },
		]);
	});
});
