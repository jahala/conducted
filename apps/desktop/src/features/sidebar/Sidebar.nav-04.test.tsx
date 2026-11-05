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
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
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
	return render(
		<ServicesProvider container={container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
}

describe("NAV-04 Sidebar", () => {
	it("shows a pinned workspace and a saved section in the live list", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const pinned = await seedWorkspace(test.container, {
				repoId: repo.id,
				branch: "pinned-branch",
			});
			const grouped = await seedWorkspace(test.container, {
				repoId: repo.id,
				branch: "grouped-branch",
			});
			must(await test.container.actions.workspaces.setPinned(pinned.id, true));
			const section = must(await test.container.services.sections.create("Review", null));
			must(await test.container.services.sections.place(grouped.id, section.id, 0));

			renderSidebar(test.container);

			const pinnedRegion = await screen.findByRole("region", { name: "Pinned workspaces" });
			expect(within(pinnedRegion).getByText("pinned-branch")).toBeTruthy();

			const sectionRegion = await screen.findByRole("region", { name: "Review" });
			expect(within(sectionRegion).getByText("grouped-branch")).toBeTruthy();
			expect(within(sectionRegion).queryByText("pinned-branch")).toBeNull();
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
			await screen.findByRole("button", { name: "New section..." });
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
