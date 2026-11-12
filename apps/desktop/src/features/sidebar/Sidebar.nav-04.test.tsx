/**
 * @feature NAV-04 Pinned and sections in the sidebar
 * Owns: tests that the live sidebar mounts Pinned, the user's sections and their workspaces.
 * Test first: a saved section and a pinned workspace both show through Sidebar.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { layOut } from "../../test/pointer-drag.ts";
import { Sidebar } from "./Sidebar.tsx";

afterEach(cleanup);

const must = <T,>(
	result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

function renderSidebar(container: ReturnType<typeof createTestContainer>["container"]) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <Sidebar />,
	});
	const other = (path: string) =>
		createRoute({
			getParentRoute: () => rootRoute,
			path,
			component: () => <p>{path}</p>,
		});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <p>workspace</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([
			indexRoute,
			other("/all-workspaces"),
			other("/create"),
			other("/settings"),
			other("/dashboard"),
			workspaceRoute,
		]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	// The app's providers, as main.tsx mounts them: the footer's macOS warning reads the Mac's facts
	// through a query (useSystemInfo).
	return render(
		<AppProviders client={createQueryClient(() => {})}>
			<ServicesProvider container={container}>
				<RouterProvider router={router} />
			</ServicesProvider>
		</AppProviders>,
	);
}

/** Opens a project's group: with no workspace open, Conductor's groups start closed. */
async function openProject(name: string) {
	const region = await screen.findByRole("region", { name });
	fireEvent.click(within(region).getByRole("button", { name: new RegExp(`^${name}`) }));
}

describe("NAV-04 Sidebar", () => {
	it("names a workspace by its branch without the user's prefix, in words, as Conductor does", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.services.settings.set("branch_prefix_type", "custom"));
			must(await test.container.services.settings.set("branch_prefix_custom", "sam/"));
			const repo = await seedRepo(test.container);
			await seedWorkspace(test.container, {
				repoId: repo.id,
				branch: "sam/fix-login-redirect",
				branchIsPlaceholder: false,
			});
			renderSidebar(test.container);
			await openProject(repo.name);
			expect(await screen.findByText("Fix login redirect")).toBeTruthy();
			expect(screen.queryByText("sam/fix-login-redirect")).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("shows a pinned workspace and a saved section in the live list", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const pinned = await seedWorkspace(test.container, {
				repoId: repo.id,
				branch: "pinned-branch",
				branchIsPlaceholder: false,
			});
			const grouped = await seedWorkspace(test.container, {
				repoId: repo.id,
				branch: "grouped-branch",
				branchIsPlaceholder: false,
			});
			must(await test.container.actions.workspaces.setPinned(pinned.id, true));
			const section = must(await test.container.services.sections.create("Review", null));
			must(await test.container.services.sections.place(grouped.id, section.id, 0));

			renderSidebar(test.container);

			const pinnedRegion = await screen.findByRole("region", { name: "Pinned workspaces" });
			expect(within(pinnedRegion).getByText("Pinned branch")).toBeTruthy();

			const sectionRegion = await screen.findByRole("region", { name: "Review" });
			expect(within(sectionRegion).getByText("Grouped branch")).toBeTruthy();
			expect(within(sectionRegion).queryByText("Pinned branch")).toBeNull();
		} finally {
			test.close();
		}
	});

	it("offers New section from the sidebar background menu", async () => {
		const test = createTestContainer();
		try {
			await seedRepo(test.container);
			await seedWorkspace(test.container);
			renderSidebar(test.container);
			// "New section…" is in the "My workspaces" header's menu, as in Conductor (D098).
			await screen.findByRole("button", { name: "My workspaces actions" });
			expect(screen.queryByRole("button", { name: "New section..." })).toBeNull();
			const list = document.querySelector("[data-sidebar-list]");
			if (list === null) throw new Error("The sidebar list is missing.");
			fireEvent.contextMenu(list);
			fireEvent.click(await screen.findByRole("menuitem", { name: "New section..." }));
			expect(await screen.findByRole("dialog", { name: "New section" })).toBeTruthy();
		} finally {
			test.close();
		}
	});
});

/** Presses a row and moves past the drag threshold, so the drag is running. */
function startDrag(row: HTMLElement): void {
	fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
	fireEvent.pointerMove(document, { pointerId: 1, clientX: 10, clientY: 10 });
}

/** Moves a running drag and releases it at a point. */
function releaseAt(point: { x: number; y: number }): void {
	fireEvent.pointerMove(document, { pointerId: 1, clientX: point.x, clientY: point.y });
	fireEvent.pointerUp(document, { pointerId: 1, clientX: point.x, clientY: point.y });
}

/** The draggable row of a workspace in the live list. */
function listRow(id: string): HTMLElement {
	const row = document.querySelector<HTMLElement>(
		`[data-sidebar-list] [data-workspace-id="${id}"]`,
	);
	if (row === null) throw new Error(`The sidebar has no row for ${id}.`);
	return row;
}

describe("NAV-04 dragging in the live sidebar", () => {
	it("pins a workspace dragged out of the main list while nothing is pinned", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				branch: "to-pin",
				branchIsPlaceholder: false,
			});
			renderSidebar(test.container);
			await openProject(repo.name);
			await screen.findByText("To pin");
			expect(screen.queryByRole("region", { name: "Pinned workspaces" })).toBeNull();

			startDrag(listRow(workspace.id));

			const pinned = await screen.findByRole("region", { name: "Pinned workspaces" });
			expect(within(pinned).getByText("Drag a workspace here")).toBeTruthy();
			layOut(pinned, { left: 0, top: 0, width: 300, height: 200 });
			releaseAt({ x: 150, y: 120 });

			await waitFor(() =>
				expect(
					test.container.services.workspace.store.getState().workspacesById[workspace.id]?.pinnedAt,
				).not.toBeNull(),
			);
			await waitFor(() => {
				const row = document.querySelector<HTMLElement>(
					`[data-sidebar-list] [data-workspace-id="${workspace.id}"]`,
				);
				expect(row?.closest('[aria-label="Pinned workspaces"]')).not.toBeNull();
			});
		} finally {
			test.close();
		}
	});

	it("moves a workspace dragged out of the main list into a section", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				branch: "to-move",
				branchIsPlaceholder: false,
			});
			must(await test.container.services.sections.create("Review", null));
			renderSidebar(test.container);
			await openProject(repo.name);
			await screen.findByText("To move");
			const section = await screen.findByRole("region", { name: "Review" });
			expect(within(section).queryByText("To move")).toBeNull();

			startDrag(listRow(workspace.id));
			layOut(section, { left: 0, top: 0, width: 300, height: 200 });
			releaseAt({ x: 150, y: 120 });

			expect(await within(section).findByText("To move")).toBeTruthy();
		} finally {
			test.close();
		}
	});
});
