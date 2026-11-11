/**
 * @feature CHAT-01 Create, close, rename chats; chat history; NAV-10 Tab strip
 * Owns: the join tests that close chats through the real container and route tree: the confirmation
 * for a working chat, stopping its agent, the next chat becoming active, "Close others", and
 * `/clear` opening a replacement.
 * Behaviour: research/conductor/success-side-effects.md row 6 (renderApp @10110273, @11398676,
 * main @3635568 and @3636298), ui-map.md 3.2.
 * Test first: closing a working chat asks first and stops its agent.
 */
import { idleLiveState, type SessionConfig } from "@conducted/protocol";
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
import { answerSidecar } from "../test/sidecar-answers.ts";
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

/** Answers cancel as the sidecar does; every other request gets an empty result. */
function answer(test: TestContainer) {
	return answerSidecar(test, (call) =>
		call.method === "cancel" ? { wasWorking: true, droppedMessageIds: [] } : {},
	);
}

async function openWorkspace(container: Container, workspace: Workspace, sessionId?: SessionId) {
	const search =
		sessionId === undefined ? "" : `?tab=session&sessionId=${encodeURIComponent(sessionId)}`;
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

/** One chat with a short transcript, titled so its tab and close button have a name. */
async function seedChat(
	test: TestContainer,
	workspace: Workspace,
	title: string,
): Promise<SessionId> {
	const created = await test.container.services.sessions.create(workspace.id, CONFIG);
	const session = must(created);
	await test.container.services.sessions.rename(session.id, title);
	await appendChatEvents(test.container, session.id, [
		userMessageEvent("u1", "t1", 10),
		agentEvent("a1", "t1", 12, [{ kind: "text", text: `Answer from ${title}` }]),
		turnEndedEvent("e1", "t1", 14),
	]);
	await test.container.services.sessions.start();
	return session.id;
}

function markWorking(test: TestContainer, sessionId: SessionId): void {
	test.container.services.sessions.store.setState((state) => ({
		liveStates: {
			...state.liveStates,
			[sessionId]: { ...idleLiveState, status: "working" },
		},
	}));
}

describe("closing a chat", () => {
	it("closing a working chat asks first and stops its agent", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container);
			const sessionId = await seedChat(test, workspace, "Original chat");
			markWorking(test, sessionId);
			must(await test.container.sidecar.start());
			const calls = answer(test);

			const router = await openWorkspace(test.container, workspace, sessionId);
			await screen.findByText("Answer from Original chat");

			fireEvent.click(screen.getByRole("button", { name: "Close Original chat" }));

			expect(await screen.findByText("Close running chat?")).toBeTruthy();
			expect(
				screen.getByText("This chat is currently running. Closing it will cancel Claude."),
			).toBeTruthy();
			expect(
				test.container.services.sessions.store.getState().sessions[sessionId]?.closedAt,
			).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: /Close anyway/ }));

			await waitFor(() =>
				expect(
					test.container.services.sessions.store.getState().sessions[sessionId]?.closedAt,
				).not.toBeNull(),
			);
			await waitFor(() => expect(calls.some((call) => call.method === "cancel")).toBe(true));
			expect(calls.find((call) => call.method === "cancel")?.params.sessionId).toBe(sessionId);

			const open = test.container.services.sessions.store.getState().byWorkspace[workspace.id];
			expect(open).toHaveLength(1);
			expect(open?.[0]).not.toBe(sessionId);
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

	it("'Close others' asks once and stops the other agents", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container);
			const kept = await seedChat(test, workspace, "Kept chat");
			const second = await seedChat(test, workspace, "Second chat");
			const third = await seedChat(test, workspace, "Third chat");
			markWorking(test, second);
			markWorking(test, third);
			must(await test.container.sidecar.start());
			const calls = answer(test);

			await openWorkspace(test.container, workspace, kept);
			await screen.findByText("Answer from Kept chat");

			fireEvent.contextMenu(screen.getByRole("tab", { name: "Kept chat" }));
			fireEvent.click(await screen.findByRole("menuitem", { name: "Close others" }));

			expect(await screen.findByText("Close running chats?")).toBeTruthy();
			expect(
				screen.getByText("2 chats are currently running. Closing them will stop their agents."),
			).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: /Close anyway/ }));

			await waitFor(() => {
				const state = test.container.services.sessions.store.getState();
				expect(state.sessions[second]?.closedAt).not.toBeNull();
				expect(state.sessions[third]?.closedAt).not.toBeNull();
			});
			expect(test.container.services.sessions.store.getState().sessions[kept]?.closedAt).toBeNull();
			expect(calls.filter((call) => call.method === "cancel")).toHaveLength(2);
			await waitFor(() =>
				expect(
					test.container.services.workspace.store.getState().workspacesById[workspace.id]
						?.activeSessionId,
				).toBe(kept),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("clearing a chat", () => {
	it("clearing a chat stops its agent and opens its replacement", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container);
			const sessionId = await seedChat(test, workspace, "Old chat");
			markWorking(test, sessionId);
			must(await test.container.sidecar.start());
			const calls = answer(test);

			const router = await openWorkspace(test.container, workspace, sessionId);
			await screen.findByText("Answer from Old chat");

			const cleared = await test.container.actions.sessions.clear(sessionId);
			expect(cleared.ok).toBe(true);
			if (!cleared.ok) return;

			expect(cleared.value.id).not.toBe(sessionId);
			expect(
				test.container.services.sessions.store.getState().sessions[sessionId]?.closedAt,
			).not.toBeNull();
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					tab: "session",
					sessionId: cleared.value.id,
				}),
			);
			await waitFor(() => expect(calls.some((call) => call.method === "cancel")).toBe(true));
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
