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
import { dragPointer, layOut, middleOf } from "../../test/pointer-drag.ts";
import { PinnedSection } from "./PinnedSection.tsx";
import { useWorkspaceDragController, WorkspaceDragProvider } from "./workspace-drag-context.tsx";

afterEach(cleanup);

function renderWith(container: ReturnType<typeof createTestContainer>["container"], ui: ReactNode) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <WorkspaceDragProvider>{ui}</WorkspaceDragProvider>,
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

/** A row in another list that starts a workspace drag, as the main list does. */
function ExternalDrag({ id }: { id: WorkspaceId }) {
	const drag = useWorkspaceDragController();
	return (
		<button type="button" onPointerDown={(event) => drag.start(event, { kind: "workspace", id })}>
			Start drag
		</button>
	);
}

const PINNED_BOX = { left: 0, top: 0, width: 300, height: 200 };

describe("NAV-04 PinnedSection", () => {
	it("pins a workspace dropped on the section", async () => {
		const test = createTestContainer();
		try {
			await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container);
			const setPinned = vi
				.spyOn(test.container.actions.workspaces, "setPinned")
				.mockResolvedValue(ok(undefined));
			renderWith(
				test.container,
				<PinnedSection workspaces={[workspace]} allWorkspaces={[workspace]} />,
			);
			const region = await screen.findByRole("region", { name: "Pinned workspaces" });
			layOut(region, PINNED_BOX);
			const row = region.querySelector(`[data-workspace-id="${workspace.id}"]`);
			if (row === null) throw new Error("The pinned row is missing.");
			layOut(row, { left: 0, top: 0, width: 300, height: 40 });
			dragPointer(row, { x: 150, y: 120 });
			await waitFor(() => expect(setPinned).toHaveBeenCalledWith(workspace.id, true));
		} finally {
			test.close();
		}
	});

	it("pins a workspace dragged out of the main list", async () => {
		const test = createTestContainer();
		try {
			await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container);
			const setPinned = vi
				.spyOn(test.container.actions.workspaces, "setPinned")
				.mockResolvedValue(ok(undefined));
			// The pinned list is empty: the workspace only exists in the full list.
			renderWith(
				test.container,
				<>
					<ExternalDrag id={workspace.id} />
					<PinnedSection workspaces={[]} allWorkspaces={[workspace]} dragging />
				</>,
			);
			const region = await screen.findByRole("region", { name: "Pinned workspaces" });
			layOut(region, PINNED_BOX);
			dragPointer(screen.getByRole("button", { name: "Start drag" }), middleOf(PINNED_BOX));
			await waitFor(() => expect(setPinned).toHaveBeenCalledWith(workspace.id, true));
		} finally {
			test.close();
		}
	});

	it("is hidden when it is empty and nothing is being dragged", () => {
		const test = createTestContainer();
		try {
			renderWith(test.container, <PinnedSection workspaces={[]} allWorkspaces={[]} />);
			expect(screen.queryByRole("region", { name: "Pinned workspaces" })).toBeNull();
		} finally {
			test.close();
		}
	});

	it("shows the drop hint when it is empty during a drag", async () => {
		const test = createTestContainer();
		try {
			renderWith(test.container, <PinnedSection workspaces={[]} allWorkspaces={[]} dragging />);
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
			renderWith(
				test.container,
				<PinnedSection workspaces={[workspace]} allWorkspaces={[workspace]} />,
			);
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
			renderWith(
				test.container,
				<PinnedSection workspaces={[archived]} allWorkspaces={[archived]} />,
			);
			const region = await screen.findByRole("region", { name: "Pinned workspaces" });
			layOut(region, PINNED_BOX);
			const row = region.querySelector(`[data-workspace-id="${archived.id}"]`);
			if (row === null) throw new Error("The pinned row is missing.");
			layOut(row, { left: 0, top: 0, width: 300, height: 40 });
			dragPointer(row, { x: 150, y: 120 });
			await Promise.resolve();
			expect(setPinned).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});
});
