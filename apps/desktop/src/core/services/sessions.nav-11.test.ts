/**
 * @feature NAV-11 Unread state
 * Owns: the tests for marking chats and workspaces read or unread and for remembering the chat
 * on screen.
 * Behaviour: ui-map.md 3.1, 3.2, 4; services-map.md 2.3.3.
 * Test first: a chat that waits for the user keeps its unread count when the workspace is marked read.
 */
import type { LiveState, SessionConfig } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const questionState = (): LiveState => ({
	status: "idle",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
	openInteraction: {
		interactionId: "i-1" as InteractionId,
		interaction: {
			kind: "question",
			questions: [{ question: "Continue?", options: [], multiSelect: false }],
		},
		since: 1000,
	},
});

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

async function storedUnread(
	container: ReturnType<typeof createTestContainer>["container"],
	sessionId: SessionId,
): Promise<number> {
	const rows = await container.platform.db.select<{ unread_count: number }>(
		"SELECT unread_count FROM sessions WHERE id = $1",
		[sessionId],
	);
	return rows[0]?.unread_count ?? -1;
}

describe("NAV-11 sessions read state", () => {
	it("marks one chat unread once, then read, in the store and on disk", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			must(await test.container.services.sessions.markUnread(session.id));
			must(await test.container.services.sessions.markUnread(session.id));
			expect(
				test.container.services.sessions.store.getState().sessions[session.id]?.unreadCount,
			).toBe(1);
			expect(await storedUnread(test.container, session.id)).toBe(1);

			must(await test.container.services.sessions.markRead(session.id));
			expect(
				test.container.services.sessions.store.getState().sessions[session.id]?.unreadCount,
			).toBe(0);
			expect(await storedUnread(test.container, session.id)).toBe(0);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("marks the workspace's newest chat unread", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const first = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const second = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			must(await test.container.services.sessions.markWorkspaceUnread(workspace.id));

			const state = test.container.services.sessions.store.getState();
			expect(state.sessions[second.id]?.unreadCount).toBe(1);
			expect(state.sessions[first.id]?.unreadCount).toBe(0);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("clears a whole workspace but keeps a chat that waits for the user", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const waiting = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const plain = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.markUnread(waiting.id));
			must(await test.container.services.sessions.markUnread(plain.id));
			must(await test.container.services.sessions.applyLiveState(waiting.id, questionState()));

			must(await test.container.services.sessions.markAllRead(workspace.id));

			const state = test.container.services.sessions.store.getState();
			expect(state.sessions[waiting.id]?.unreadCount).toBe(1);
			expect(state.sessions[plain.id]?.unreadCount).toBe(0);
			expect(await storedUnread(test.container, waiting.id)).toBe(1);
			expect(await storedUnread(test.container, plain.id)).toBe(0);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("remembers and forgets the chat on screen", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			test.container.services.sessions.setViewing(session.id);
			expect(test.container.services.sessions.store.getState().viewingSessionId).toBe(session.id);

			test.container.services.sessions.setViewing(null);
			expect(test.container.services.sessions.store.getState().viewingSessionId).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("lets two overlapping mark-read calls settle without a late overwrite", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.markUnread(session.id));

			const [first, second] = await Promise.all([
				test.container.services.sessions.markAllRead(workspace.id),
				test.container.services.sessions.markAllRead(workspace.id),
			]);

			expect(first.ok).toBe(true);
			expect(second.ok).toBe(true);
			expect(
				test.container.services.sessions.store.getState().sessions[session.id]?.unreadCount,
			).toBe(0);
			expect(await storedUnread(test.container, session.id)).toBe(0);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("keeps a count a new message raised while the workspace was being marked read", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.markUnread(session.id));

			const db = test.container.platform.db;
			const execute = db.execute.bind(db);
			let armed = true;
			db.execute = async (sql, params = []) => {
				const result = await execute(sql, params);
				if (armed && sql.includes("UPDATE sessions SET unread_count = 0")) {
					armed = false;
					// An agent message arrives after the clear but before the store is told.
					await execute(
						"UPDATE sessions SET unread_count = unread_count + 1 WHERE id = $1",
						params,
					);
				}
				return result;
			};

			must(await test.container.services.sessions.markAllRead(workspace.id));

			expect(
				test.container.services.sessions.store.getState().sessions[session.id]?.unreadCount,
			).toBe(1);
			expect(await storedUnread(test.container, session.id)).toBe(1);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
