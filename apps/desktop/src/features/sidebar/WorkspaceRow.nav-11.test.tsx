/**
 * @feature NAV-11 Unread state
 * Owns: the test for the hover key R that toggles a workspace's read state.
 * Behaviour: ui-map.md 4 ("hover keys R read").
 * Test first: with the pointer on an unread row, R marks the workspace read; R again marks it unread.
 */
import type { SessionConfig } from "@conducted/protocol";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(cleanup);

describe("NAV-11 workspace row read key", () => {
	it("toggles the hovered workspace read and unread with R", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.markUnread(session.id));

			renderRow(
				test.container,
				<WorkspaceRow
					workspace={workspace}
					repo={repo}
					selected={false}
					shortcutIndex={null}
					now={workspace.lastActivityAt}
				/>,
			);
			const link = await screen.findByRole("link");
			fireEvent.mouseEnter(link);
			fireEvent.keyDown(link, { key: "r" });
			await waitFor(() =>
				expect(
					test.container.services.sessions.store.getState().sessions[session.id]?.unreadCount,
				).toBe(0),
			);

			fireEvent.keyDown(link, { key: "r" });
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
});
