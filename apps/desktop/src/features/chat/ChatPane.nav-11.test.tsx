/**
 * @feature NAV-11 Unread state
 * Owns: the test for opening a chat: it marks the screen's chat as viewed and clears its siblings'
 * unread counts, then forgets the screen's chat on unmount.
 * Behaviour: ui-map.md 4 ("Opening a workspace clears the unread dot of its chats, except chats
 * that still wait").
 * Test first: mounting a chat sets viewingSessionId and clears a sibling chat's count; unmounting
 * clears viewingSessionId.
 */
import type { SessionConfig } from "@conducted/protocol";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

vi.mock("./MessageList.tsx", () => ({ MessageList: () => <div>list</div> }));
vi.mock("./ProgressTracker.tsx", () => ({ ProgressTracker: () => <div>progress</div> }));
vi.mock("../composer/QueueBox.tsx", () => ({ QueueBox: () => <div>queue</div> }));
vi.mock("../composer/Composer.tsx", () => ({ Composer: () => <div>composer</div> }));
vi.mock("./interactions/InteractionDock.tsx", () => ({
	InteractionDock: () => <div>dock</div>,
}));
vi.mock("./NextUnreadButton.tsx", () => ({ NextUnreadButton: () => null }));

const { ChatPane } = await import("./ChatPane.tsx");

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

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

afterEach(cleanup);

describe("NAV-11 chat pane read state", () => {
	it("records the chat on screen, clears its siblings, and forgets it on unmount", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const current = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const sibling = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.markUnread(current.id));
			must(await test.container.services.sessions.markUnread(sibling.id));

			const view = render(
				<ServicesProvider container={test.container}>
					<ChatPane workspaceId={workspace.id} sessionId={current.id} />
				</ServicesProvider>,
			);

			await waitFor(() =>
				expect(
					test.container.services.sessions.store.getState().sessions[sibling.id]?.unreadCount,
				).toBe(0),
			);
			expect(test.container.services.sessions.store.getState().viewingSessionId).toBe(current.id);

			view.unmount();
			expect(test.container.services.sessions.store.getState().viewingSessionId).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
