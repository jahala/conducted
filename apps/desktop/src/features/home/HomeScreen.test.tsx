import { appError, ok } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { HomeScreen } from "./HomeScreen.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

function nameWorkspace(
	container: TestContainer["container"],
	workspace: { id: string },
	displayName: string,
) {
	container.services.workspace.store.setState((state) => {
		const row = state.workspacesById[workspace.id];
		if (row === undefined) return state;
		return {
			workspacesById: { ...state.workspacesById, [workspace.id]: { ...row, displayName } },
		};
	});
}

function renderHome(container: TestContainer["container"]) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<ServicesProvider container={container}>
				<HomeScreen />
			</ServicesProvider>
		),
	});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <p>workspace</p>,
	});
	const createRoutePage = createRoute({
		getParentRoute: () => rootRoute,
		path: "/create",
		component: () => <p>create</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, workspaceRoute, createRoutePage]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(<RouterProvider router={router} />);
}

describe("NAV-05 HomeScreen", () => {
	it("shows a loading skeleton while the stores load", async () => {
		test = createTestContainer();
		renderHome(test.container);
		expect(await screen.findByRole("status", { name: "Loading workspaces" })).toBeTruthy();
	});

	it("shows an error with a Retry that starts the repository service again", async () => {
		test = createTestContainer();
		const error = appError("repo_read_failed", "The project list could not be read.");
		test.container.services.repo.store.setState({ loaded: true, error });
		const start = vi.spyOn(test.container.services.repo, "start").mockResolvedValue(ok(undefined));
		renderHome(test.container);
		expect(await screen.findByRole("heading", { name: "Couldn't load workspaces" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
	});

	it("shows 50 cards first and Show more reveals the rest", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		for (let index = 0; index < 60; index += 1) {
			await seedWorkspace(test.container, {
				repoId: repo.id,
				directoryName: `workspace-${String(index).padStart(2, "0")}`,
			});
		}
		renderHome(test.container);
		await waitFor(() => expect(screen.getAllByTestId("home-workspace-card")).toHaveLength(50));
		fireEvent.click(screen.getByRole("button", { name: "Show more" }));
		await waitFor(() => expect(screen.getAllByTestId("home-workspace-card")).toHaveLength(60));
		expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
	});

	it("puts a pinned workspace in its own group", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const pinned = await seedWorkspace(test.container, { repoId: repo.id });
		const plain = await seedWorkspace(test.container, { repoId: repo.id });
		nameWorkspace(test.container, pinned, "Pinned work");
		nameWorkspace(test.container, plain, "Plain work");
		test.container.services.workspace.store.setState((state) => {
			const row = state.workspacesById[pinned.id];
			if (row === undefined) return state;
			return {
				workspacesById: { ...state.workspacesById, [pinned.id]: { ...row, pinnedAt: 1 } },
			};
		});
		renderHome(test.container);
		const region = await screen.findByRole("region", { name: "Pinned" });
		expect(within(region).getByText("Pinned work")).toBeTruthy();
		expect(within(region).queryByText("Plain work")).toBeNull();
		// Conductor's Home has no title in its strip and no heading over the pinned group (D098).
		expect(screen.queryByRole("heading", { name: "Pinned" })).toBeNull();
		expect(screen.queryByRole("heading", { name: "Home" })).toBeNull();
	});

	it("reaches an archived workspace with the archived filter", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const active = await seedWorkspace(test.container, { repoId: repo.id });
		const archived = await seedWorkspace(test.container, { repoId: repo.id });
		nameWorkspace(test.container, active, "Active work");
		nameWorkspace(test.container, archived, "Old work");
		test.container.services.workspace.store.setState((state) => {
			const row = state.workspacesById[archived.id];
			if (row === undefined) return state;
			return {
				workspacesById: {
					...state.workspacesById,
					[archived.id]: { ...row, state: "archived", archivedAt: 10 },
				},
			};
		});
		renderHome(test.container);
		await screen.findByText("Active work");
		expect(screen.queryByText("Old work")).toBeNull();
		// The archive filter is Conductor's select now; "Only archived" replaces the Archived toggle.
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Archived workspaces" }), {
			key: "Enter",
		});
		fireEvent.keyDown(await screen.findByRole("option", { name: "Only archived" }), {
			key: "Enter",
		});
		expect(await screen.findByText("Old work")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Unarchive" })).toBeTruthy();
	});

	it("says No matching workspaces and Clear filters brings the grid back", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const alpha = await seedWorkspace(test.container, { repoId: repo.id });
		nameWorkspace(test.container, alpha, "Alpha work");
		renderHome(test.container);
		await screen.findByText("Alpha work");
		fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
			target: { value: "nothing matches this" },
		});
		expect(await screen.findByRole("heading", { name: "No matching workspaces" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
		expect(await screen.findByText("Alpha work")).toBeTruthy();
	});
});
