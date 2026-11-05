/**
 * @feature NAV-04 Pinned section
 * Owns: tests for the Pinned group and its drop target.
 * Test first: Dropping a workspace on the section calls setPinned(id, true).
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Workspace } from "../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { PinnedSection } from "./PinnedSection.tsx";
import { WORKSPACE_DRAG_MIME } from "./use-workspace-drag.ts";

afterEach(cleanup);

function renderWith(container: ReturnType<typeof createTestContainer>["container"], ui: ReactNode) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{ui}</>,
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

const dropData = (id: string) => ({
	getData: (type: string) => (type === WORKSPACE_DRAG_MIME ? id : ""),
	setData: vi.fn(),
});

describe("NAV-04 PinnedSection", () => {
	it("pins a workspace dropped on the section", async () => {
		const test = createTestContainer();
		try {
			await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container);
			const setPinned = vi
				.spyOn(test.container.actions.workspaces, "setPinned")
				.mockResolvedValue(ok(undefined));
			renderWith(test.container, <PinnedSection workspaces={[workspace]} />);
			const region = await screen.findByRole("region", { name: "Pinned workspaces" });
			fireEvent.drop(region, { dataTransfer: dropData(workspace.id) });
			await waitFor(() => expect(setPinned).toHaveBeenCalledWith(workspace.id, true));
		} finally {
			test.close();
		}
	});

	it("is hidden when it is empty and nothing is being dragged", () => {
		const test = createTestContainer();
		try {
			renderWith(test.container, <PinnedSection workspaces={[]} />);
			expect(screen.queryByRole("region", { name: "Pinned workspaces" })).toBeNull();
		} finally {
			test.close();
		}
	});

	it("shows the drop hint when it is empty during a drag", async () => {
		const test = createTestContainer();
		try {
			renderWith(test.container, <PinnedSection workspaces={[]} dragging />);
			const region = await screen.findByRole("region", { name: "Pinned workspaces" });
			expect(within(region).getByText("Drag a workspace here")).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("shows the count when collapsed", async () => {
		const test = createTestContainer();
		try {
			await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container);
			renderWith(test.container, <PinnedSection workspaces={[workspace]} />);
			const region = await screen.findByRole("region", { name: "Pinned workspaces" });
			fireEvent.click(within(region).getByRole("button", { name: "Pinned" }));
			expect(within(region).getByText("1")).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("refuses a drop of an archived workspace", async () => {
		const test = createTestContainer();
		try {
			await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container);
			const archived: Workspace = { ...workspace, state: "archived" };
			const setPinned = vi
				.spyOn(test.container.actions.workspaces, "setPinned")
				.mockResolvedValue(ok(undefined));
			renderWith(test.container, <PinnedSection workspaces={[archived]} />);
			const region = await screen.findByRole("region", { name: "Pinned workspaces" });
			fireEvent.drop(region, { dataTransfer: dropData(archived.id as WorkspaceId) });
			await Promise.resolve();
			expect(setPinned).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});
});
