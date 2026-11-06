/**
 * @feature CHAT-13 Progress tracker
 * Owns: tests of the progress part of the sessions service: an update replaces the chat's tracker,
 * an empty update clears it, a new turn clears it and a steer in the running turn does not.
 * Behaviour: ui-map.md 3.3, claude-runner.md 4.2 (each call replaces the last; an empty list
 * clears the tracker).
 * Test first: an empty update removes the tracker from the chat view.
 */
import type { Progress, SessionConfig, SessionEvent } from "@conducted/protocol";
import type { EventId, MessageId, TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { sessionConfig } from "../db/test-fixtures.ts";

const CONFIG: SessionConfig = {
	...sessionConfig,
	appTools: { ...sessionConfig.appTools, progressUpdates: true },
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const PROGRESS: Progress = {
	title: "Building",
	blocks: [
		{
			kind: "steps",
			steps: [
				{ label: "Plan", status: "done" },
				{ label: "Write", status: "in_progress" },
			],
		},
	],
};

function userMessage(delivery: "new_turn" | "steer"): SessionEvent {
	return {
		type: "user_message",
		eventId: "event-1" as EventId,
		at: 10,
		messageId: "message-1" as MessageId,
		turnId: "turn-1" as TurnId,
		text: "Go on",
		attachmentPaths: [],
		delivery,
		config: CONFIG,
	};
}

async function setup() {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container);
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	return { test, session };
}

describe("CHAT-13 progress store", () => {
	it("replaces the chat's tracker on every update", async () => {
		const { test, session } = await setup();
		try {
			const sessions = test.container.services.sessions;
			sessions.setProgress(session.id, PROGRESS);

			expect(sessions.chatView(session.id)?.progress).toEqual(PROGRESS);

			const next: Progress = { blocks: [{ kind: "text", text: "Almost there" }] };
			sessions.setProgress(session.id, next);
			expect(sessions.chatView(session.id)?.progress).toEqual(next);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("clears the tracker when the agent sends no blocks", async () => {
		const { test, session } = await setup();
		try {
			const sessions = test.container.services.sessions;
			sessions.setProgress(session.id, PROGRESS);
			sessions.setProgress(session.id, { blocks: [] });

			expect(sessions.chatView(session.id)?.progress).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("clears the tracker when a new turn starts", async () => {
		const { test, session } = await setup();
		try {
			const sessions = test.container.services.sessions;
			sessions.setProgress(session.id, PROGRESS);
			sessions.applyStoredEvent(session.id, 1, userMessage("new_turn"), 10);

			expect(sessions.chatView(session.id)?.progress).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("keeps the tracker when the user steers the running turn", async () => {
		const { test, session } = await setup();
		try {
			const sessions = test.container.services.sessions;
			sessions.setProgress(session.id, PROGRESS);
			sessions.applyStoredEvent(session.id, 1, userMessage("steer"), 10);

			expect(sessions.chatView(session.id)?.progress).toEqual(PROGRESS);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
