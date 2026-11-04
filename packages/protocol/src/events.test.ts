import { expect, test } from "bun:test";
import { zSessionEvent } from "./events.ts";
import { zSessionEventEnvelope } from "./rpc.ts";

const config = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: false, setTargetBranch: true },
};

test("a user message event round-trips through the schema", () => {
	const event = {
		type: "user_message",
		eventId: "e1",
		at: 1,
		messageId: "m1",
		turnId: "t1",
		text: "Fix the login bug",
		attachmentPaths: [],
		delivery: "new_turn",
		config,
	};
	const parsed: unknown = zSessionEvent.parse(event);
	expect(parsed).toEqual(event);
});

test("an agent event with an unknown item kind is rejected", () => {
	const bad = {
		sessionId: "s1",
		sequence: 0,
		event: {
			type: "agent",
			eventId: "e2",
			at: 2,
			turnId: "t1",
			message: { agent: "claude", items: [{ kind: "telepathy" }] },
		},
	};
	expect(zSessionEventEnvelope.safeParse(bad).success).toBe(false);
});

test("an empty id is rejected", () => {
	expect(
		zSessionEvent.safeParse({
			type: "turn_ended",
			eventId: "",
			at: 3,
			turnId: "t1",
			outcome: "success",
		}).success,
	).toBe(false);
});
