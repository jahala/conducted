/**
 * @feature CHAT-01 Create, close, rename chats; chat history; NAV-10 Tab strip
 * Owns: the join test that closes the last chat tab through the real container and route tree and
 * checks that its transcript is gone and a new chat is shown.
 * Behaviour: research/conductor/success-side-effects.md row 6 (main @3635568 hideSession creates a
 * replacement chat when no other is open), ui-map.md 3.2.
 * Test first: closing the last chat tab shows a new chat instead of its transcript.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the app route exactly as the app does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the app route exactly as the app does
import { createAppRouter } from "../app/router.tsx";
import {
	agentEvent,
	appendChatEvents,
	turnEndedEvent,
	userMessageEvent,
} from "../test/chat-events.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import type { Workspace } from "./model.ts";

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

async function openWorkspace(container: Container, workspace: Workspace, sessionId: SessionId) {
	const search = `?tab=session&sessionId=${encodeURIComponent(sessionId)}`;
	const router = createAppRouter(
		createMemoryHistory({
			initialEntries: [`/repository/${workspace.repoId}/workspace/${workspace.id}${search}`],
		}),
	);
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
					<RouterProvider router={router} />
				</VirtuosoMockContext.Provider>
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

describe("closing the last chat tab", () => {
	it("closing the last chat tab shows a new chat instead of its transcript", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container);
			const created = await test.container.services.sessions.create(workspace.id, CONFIG);
			const session = must(created);
			await test.container.services.sessions.rename(session.id, "Only chat");
			await appendChatEvents(test.container, session.id, [
				userMessageEvent("u1", "t1", 10),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "Answer from Only chat" }]),
				turnEndedEvent("e1", "t1", 14),
			]);
			await test.container.services.sessions.start();

			const router = await openWorkspace(test.container, workspace, session.id);
			await screen.findByText("Answer from Only chat");

			fireEvent.click(screen.getByRole("button", { name: "Close Only chat" }));

			await waitFor(() => expect(screen.queryByText("Answer from Only chat")).toBeNull());
			const open = test.container.services.sessions.store.getState().byWorkspace[workspace.id];
			expect(open).toHaveLength(1);
			expect(open?.[0]).not.toBe(session.id);
			expect(
				test.container.services.sessions.store.getState().sessions[session.id]?.closedAt,
			).not.toBeNull();
			expect(await screen.findByRole("tab", { name: "New chat" })).toBeTruthy();
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					tab: "session",
					sessionId: open?.[0],
				}),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
