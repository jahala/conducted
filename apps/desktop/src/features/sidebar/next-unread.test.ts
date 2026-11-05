/**
 * @feature NAV-11 Next unread
 * Owns: the tests for choosing the next chat that needs the user.
 * Behaviour: ui-map.md 3.3, 5.1, 5.4.
 * Test first: with two chats in one workspace, one waiting and one merely unread, the waiting chat
 * comes first.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Session, Workspace } from "../../core/model.ts";
import { chooseNextUnread, type UnreadCandidate } from "./next-unread.ts";

const workspace = (id: string, over: Partial<Workspace> = {}): Workspace =>
	({
		id: id as WorkspaceId,
		state: "ready",
		activeSessionId: null,
		...over,
	}) as Workspace;

const chat = (id: string, workspaceId: string, over: Partial<Session> = {}): Session =>
	({
		id: id as SessionId,
		workspaceId: workspaceId as WorkspaceId,
		unreadCount: 0,
		closedAt: null,
		updatedAt: 100,
		createdAt: 100,
		lastUserMessageAt: null,
		...over,
	}) as Session;

const candidate = (
	id: string,
	sessions: Session[],
	waitingSessionIds: SessionId[] = [],
	over: Partial<Workspace> = {},
): UnreadCandidate => ({
	workspace: workspace(id, over),
	sessions,
	waitingSessionIds: new Set(waitingSessionIds),
});

describe("NAV-11 chooseNextUnread", () => {
	it("picks the waiting chat, not the merely unread chat in the same workspace", () => {
		const target = chooseNextUnread({
			candidates: [
				candidate(
					"w1",
					[
						chat("s-unread", "w1", { unreadCount: 1, updatedAt: 100 }),
						chat("s-waiting", "w1", { unreadCount: 1, updatedAt: 200 }),
					],
					["s-waiting" as SessionId],
				),
			],
			current: null,
		});
		expect(target).toEqual({ workspaceId: "w1", sessionId: "s-waiting" });
	});

	it("puts a chat waiting for permission before a merely unread chat in another workspace", () => {
		const target = chooseNextUnread({
			candidates: [
				candidate("w-unread", [chat("s-unread", "w-unread", { unreadCount: 1 })]),
				candidate("w-waiting", [chat("s-waiting", "w-waiting")], ["s-waiting" as SessionId]),
			],
			current: null,
		});
		expect(target).toEqual({ workspaceId: "w-waiting", sessionId: "s-waiting" });
	});

	it("returns null when nothing needs the user", () => {
		expect(
			chooseNextUnread({
				candidates: [
					candidate("w1", [chat("s1", "w1")]),
					candidate("w2", [chat("s2", "w2", { closedAt: 500, unreadCount: 2 })]),
				],
				current: null,
			}),
		).toBeNull();
	});

	it("ignores the current chat when it is the only unread one", () => {
		expect(
			chooseNextUnread({
				candidates: [candidate("w1", [chat("s1", "w1", { unreadCount: 1 })])],
				current: { workspaceId: "w1" as WorkspaceId, sessionId: "s1" as SessionId },
			}),
		).toBeNull();
	});

	it("skips archived workspaces", () => {
		expect(
			chooseNextUnread({
				candidates: [
					candidate("w-old", [chat("s-old", "w-old", { unreadCount: 3 })], [], {
						state: "archived",
					}),
				],
				current: null,
			}),
		).toBeNull();
	});

	it("walks through the chats and wraps around", () => {
		const candidates = [
			candidate("w1", [chat("s1", "w1", { unreadCount: 1, updatedAt: 100 })]),
			candidate("w2", [chat("s2", "w2", { unreadCount: 1, updatedAt: 200 })]),
		];
		const first = chooseNextUnread({ candidates, current: null });
		expect(first).toEqual({ workspaceId: "w1", sessionId: "s1" });

		const second = chooseNextUnread({ candidates, current: first });
		expect(second).toEqual({ workspaceId: "w2", sessionId: "s2" });

		const wrapped = chooseNextUnread({ candidates, current: second });
		expect(wrapped).toEqual({ workspaceId: "w1", sessionId: "s1" });
	});

	it("chooses the oldest waiting chat first", () => {
		const target = chooseNextUnread({
			candidates: [
				candidate("w-new", [chat("s-new", "w-new", { updatedAt: 900 })], ["s-new" as SessionId]),
				candidate("w-old", [chat("s-old", "w-old", { updatedAt: 100 })], ["s-old" as SessionId]),
			],
			current: null,
		});
		expect(target).toEqual({ workspaceId: "w-old", sessionId: "s-old" });
	});

	it("targets a waiting chat even when it has no unread count", () => {
		const target = chooseNextUnread({
			candidates: [candidate("w1", [chat("s-waiting", "w1")], ["s-waiting" as SessionId])],
			current: null,
		});
		expect(target).toEqual({ workspaceId: "w1", sessionId: "s-waiting" });
	});

	it("starts again at the first chat when the current chat is not a target", () => {
		const candidates = [candidate("w1", [chat("s1", "w1", { unreadCount: 1 })])];
		expect(
			chooseNextUnread({
				candidates,
				current: { workspaceId: "w2" as WorkspaceId, sessionId: "s2" as SessionId },
			}),
		).toEqual({ workspaceId: "w1", sessionId: "s1" });
	});
});
