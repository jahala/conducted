/**
 * @feature NAV-03 Grouped workspace list
 * Owns: tests for the "My workspaces" header that folds the main list, measured from Conductor.
 * Behaviour: renderApp's header button (`Rtr`, @10493990) carries aria-expanded and a right chevron
 * while folded, a down chevron on hover or focus while open, and the fold is remembered.
 * Test first: clicking the "My workspaces" header folds the list and the saved fold survives a new
 * mount.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo, Workspace } from "../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { GroupedWorkspaces } from "./GroupedWorkspaces.tsx";

afterEach(cleanup);

function renderList(
	container: ReturnType<typeof createTestContainer>["container"],
	repos: Repo[],
	workspaces: Workspace[],
	path: string,
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
		component: () => <GroupedWorkspaces repos={repos} workspaces={workspaces} sections={[]} />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, workspaceRoute]),
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	return render(
		<ServicesProvider container={container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
}

describe("NAV-03 My workspaces header", () => {
	it("folds the list from its header and keeps the saved fold on the next mount", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const path = `/repository/${repo.id}/workspace/${workspace.id}`;

			renderList(test.container, [repo], [workspace], path);
			const header = await screen.findByRole("button", { name: "My workspaces" });
			expect(header.tagName).toBe("BUTTON");
			expect(header.getAttribute("aria-expanded")).toBe("true");
			const region = await screen.findByRole("region", { name: repo.name });
			expect(region.querySelector("[data-workspace-id]")).not.toBeNull();
			expect(header.querySelector("[data-chevron]")?.getAttribute("data-chevron")).toBe("open");

			fireEvent.click(header);

			await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("false"));
			expect(header.querySelector("[data-chevron]")?.getAttribute("data-chevron")).toBe(
				"collapsed",
			);
			expect(screen.queryByRole("region", { name: repo.name })).toBeNull();
			await waitFor(async () => {
				const rows = await test.database.select<{ value: string }>(
					"SELECT value FROM settings WHERE key = $1",
					["sidebar_my_workspaces_collapsed"],
				);
				expect(rows.map((row) => row.value)).toEqual(["true"]);
			});

			cleanup();
			renderList(test.container, [repo], [workspace], path);
			expect(
				(await screen.findByRole("button", { name: "My workspaces" })).getAttribute(
					"aria-expanded",
				),
			).toBe("false");
			expect(screen.queryByRole("region", { name: repo.name })).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "My workspaces" }));
			await waitFor(() =>
				expect(
					screen.getByRole("button", { name: "My workspaces" }).getAttribute("aria-expanded"),
				).toBe("true"),
			);
			expect(await screen.findByRole("region", { name: repo.name })).toBeTruthy();
		} finally {
			test.close();
		}
	});
});
