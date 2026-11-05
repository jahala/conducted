/**
 * @feature NAV-04 Manual order in the main list
 * Owns: tests that a row dragged inside a main group saves the user's order.
 * Test first: dropping row A after row B with manual order on saves the order in the
 * `sidebar_manual_order` setting for that group.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo, Workspace } from "../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { GroupedWorkspaces } from "./GroupedWorkspaces.tsx";
import { WORKSPACE_DRAG_MIME } from "./use-workspace-drag.ts";

afterEach(cleanup);

const dropData = (id: string) => ({
	getData: (type: string) => (type === WORKSPACE_DRAG_MIME ? id : ""),
	setData: vi.fn(),
});

function renderList(
	container: ReturnType<typeof createTestContainer>["container"],
	repos: Repo[],
	workspaces: Workspace[],
) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <GroupedWorkspaces repos={repos} workspaces={workspaces} sections={[]} />,
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

describe("NAV-04 GroupedWorkspaces manual order", () => {
	it("saves the main list order when a row is dropped on another", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const first = await seedWorkspace(test.container, { repoId: repo.id });
			const second = await seedWorkspace(test.container, { repoId: repo.id });
			const third = await seedWorkspace(test.container, { repoId: repo.id });
			test.container.services.settings.store.setState((state) => ({
				...state,
				loaded: true,
				values: { ...state.values, manual_workspace_order: true },
			}));
			const save = vi
				.spyOn(test.container.actions.settings, "set")
				.mockResolvedValue(ok(undefined));

			const workspaces = [first, second, third];
			renderList(test.container, [repo], workspaces);
			const region = await screen.findByRole("region", { name: repo.name });
			const ordered = [...region.querySelectorAll("[data-workspace-id]")]
				.map((row) => row.getAttribute("data-workspace-id"))
				.filter((id): id is string => id !== null);
			const [dragged, target] = ordered;
			if (dragged === undefined || target === undefined) throw new Error("A row is missing.");
			const draggedRow = region.querySelector(`[data-workspace-id="${dragged}"]`);
			const targetRow = region.querySelector(`[data-workspace-id="${target}"]`);
			if (draggedRow === null || targetRow === null) throw new Error("A row is missing.");

			fireEvent.dragStart(draggedRow, { dataTransfer: { setData: vi.fn() } });
			fireEvent.drop(targetRow, { dataTransfer: dropData(dragged) });

			await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
			const [key, value] = save.mock.calls[0] ?? [];
			expect(key).toBe("sidebar_manual_order");
			const saved = JSON.parse(String(value)) as Record<string, WorkspaceId[]>;
			expect(saved[`project:${repo.id}`]).toEqual([target, dragged, ...ordered.slice(2)]);
		} finally {
			test.close();
		}
	});
});
