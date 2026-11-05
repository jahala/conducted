/**
 * @feature NAV-11 Unread state
 * Owns: the tests for the hover key that toggles a workspace's read state.
 * Behaviour: ui-map.md 4 ("hover keys R read"), 5.4 (a rebind changes the key).
 * Test first: with the pointer on an unread row and nothing focused, the live binding marks the
 * workspace read; the shipped key stops working after a rebind.
 */
import type { SessionConfig } from "@conducted/protocol";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { WorkspaceRow } from "./WorkspaceRow.tsx";

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

function renderRow(container: Container, row: ReactNode) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{row}</>,
	});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <p>workspace</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, workspaceRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return render(
		<ServicesProvider container={container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
}

function setReadBinding(container: Container, key: string): void {
	container.services.settings.store.setState((state) => ({
		values: {
			...state.values,
			keybinding_overrides_v1: JSON.stringify({ "sidebar.toggleRead": [key] }),
		},
	}));
}

async function unreadWorkspace(container: Container) {
	const repo = await seedRepo(container);
	const workspace = await seedWorkspace(container, { repoId: repo.id });
	await container.services.sessions.start();
	const session = must(await container.services.sessions.create(workspace.id, CONFIG));
	must(await container.services.sessions.markUnread(session.id));
	renderRow(
		container,
		<WorkspaceRow
			workspace={workspace}
			repo={repo}
			selected={false}
			shortcutIndex={null}
			now={workspace.lastActivityAt}
		/>,
	);
	const link = await screen.findByRole("link");
	return { link, session };
}

afterEach(cleanup);

describe("NAV-11 workspace row read key", () => {
	it("toggles the hovered workspace read and unread without focus", async () => {
		const test = createTestContainer();
		try {
			const { link, session } = await unreadWorkspace(test.container);
			fireEvent.mouseEnter(link);
			// The key event goes to the document, as it does in the app when nothing is focused.
			fireEvent.keyDown(document.body, { key: "r" });
			await waitFor(() =>
				expect(
					test.container.services.sessions.store.getState().sessions[session.id]?.unreadCount,
				).toBe(0),
			);

			fireEvent.keyDown(document.body, { key: "r" });
			await waitFor(() =>
				expect(
					test.container.services.sessions.store.getState().sessions[session.id]?.unreadCount,
				).toBe(1),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("follows a rebind of the toggle-read command", async () => {
		const test = createTestContainer();
		try {
			const { link, session } = await unreadWorkspace(test.container);
			act(() => setReadBinding(test.container, "X"));
			fireEvent.mouseEnter(link);

			fireEvent.keyDown(document.body, { key: "x" });
			await waitFor(() =>
				expect(
					test.container.services.sessions.store.getState().sessions[session.id]?.unreadCount,
				).toBe(0),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
