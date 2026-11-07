/**
 * @feature CHAT-16 Fork a chat from a turn
 * Tests the chat tab menu and the Cmd+Alt+Enter shortcut over the real container: both fork the
 * active chat from its latest checkpointed turn and open the new tab.
 * Test first: pressing Cmd+Alt+Enter opens a different chat than the one on screen.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import {
	agentEvent,
	appendChatEvents,
	checkpointEvent,
	turnEndedEvent,
	userMessageEvent,
} from "../../test/chat-events.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import type { WorkspaceSearch } from "./workspace-search.ts";

const { TabStrip } = await import("./TabStrip.tsx");

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

async function seedChat(): Promise<{
	test: TestContainer;
	workspaceId: WorkspaceId;
	sessionId: SessionId;
}> {
	const test = createTestContainer();
	await test.container.services.settings.start();
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const created = await test.container.services.sessions.create(workspace.id, CONFIG);
	if (!created.ok) throw new Error(JSON.stringify(created.error));
	const sessionId = created.value.id;
	await test.container.services.sessions.rename(sessionId, "Original chat");

	await appendChatEvents(test.container, sessionId, [
		userMessageEvent("u1", "t1", 10),
		checkpointEvent("c1", "t1", 11, "start", "start-1"),
		agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
		checkpointEvent("c2", "t1", 13, "end", "end-1"),
		turnEndedEvent("e1", "t1", 14),
	]);
	await test.container.services.sessions.start();
	test.container.services.settings.store.setState({
		loaded: true,
		values: { experimental_fork_to_new_tab: true },
	});
	return { test, workspaceId: workspace.id, sessionId };
}

function mount(
	test: TestContainer,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void,
): void {
	const search: WorkspaceSearch = { tab: "session", sessionId };
	render(
		<ServicesProvider container={test.container}>
			<CommandDispatcher>
				<TabStrip workspaceId={workspaceId} search={search} onSearchChange={onSearchChange} />
			</CommandDispatcher>
		</ServicesProvider>,
	);
}

afterEach(cleanup);

describe("CHAT-16 fork from the tab strip", () => {
	it("forks the active chat from its tab menu and opens the new tab", async () => {
		const { test, workspaceId, sessionId } = await seedChat();
		try {
			const onSearchChange = vi.fn();
			mount(test, workspaceId, sessionId, onSearchChange);
			fireEvent.contextMenu(await screen.findByRole("tab", { name: "Original chat" }));
			fireEvent.click(await screen.findByRole("menuitem", { name: /Fork to new tab/ }));

			await waitFor(() => expect(onSearchChange).toHaveBeenCalled());
			const patch = onSearchChange.mock.calls[0]?.[0] as Partial<WorkspaceSearch>;
			expect(patch).toMatchObject({ tab: "session" });
			expect(patch.sessionId).toBeTruthy();
			expect(patch.sessionId).not.toBe(sessionId);
			expect(
				test.container.services.sessions.store.getState().byWorkspace[workspaceId],
			).toHaveLength(2);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("forks with Cmd+Alt+Enter into the root dispatcher", async () => {
		const { test, workspaceId, sessionId } = await seedChat();
		try {
			test.container.services.sessions.setViewing(sessionId);
			const onSearchChange = vi.fn();
			mount(test, workspaceId, sessionId, onSearchChange);
			await screen.findByRole("tab", { name: "Original chat" });

			fireEvent.keyDown(document, { key: "Enter", metaKey: true, altKey: true });

			await waitFor(() => expect(onSearchChange).toHaveBeenCalled());
			const patch = onSearchChange.mock.calls[0]?.[0] as Partial<WorkspaceSearch>;
			expect(patch).toMatchObject({ tab: "session" });
			expect(patch.sessionId).toBeTruthy();
			expect(patch.sessionId).not.toBe(sessionId);
			expect(
				test.container.services.sessions.store.getState().byWorkspace[workspaceId],
			).toHaveLength(2);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
