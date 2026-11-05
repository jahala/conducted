import { ok } from "@conducted/shared";
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
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { defaultHomeDisplay, type HomeDisplay } from "./home-query.ts";
import { WorkspaceCard } from "./WorkspaceCard.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

function renderCard(workspace: Workspace, repo: Repo, display: HomeDisplay = defaultHomeDisplay()) {
	if (test === undefined) throw new Error("Create the test container first.");
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<ServicesProvider container={test?.container as TestContainer["container"]}>
				<WorkspaceCard
					workspace={workspace}
					repo={repo}
					now={workspace.lastActivityAt}
					display={display}
				/>
			</ServicesProvider>
		),
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
	render(<RouterProvider router={router} />);
}

async function seedCard(overrides: Partial<Workspace> = {}) {
	test = createTestContainer();
	const repo = await seedRepo(test.container, { name: "project-alpha" });
	const created = await seedWorkspace(test.container, { repoId: repo.id });
	const workspace = { ...created, ...overrides };
	return { repo, workspace };
}

function archive(workspace: Workspace): Workspace {
	if (test === undefined) throw new Error("Create the test container first.");
	const archived: Workspace = { ...workspace, state: "archived", archivedAt: 10 };
	test.container.services.workspace.store.setState((state) => ({
		workspacesById: { ...state.workspacesById, [workspace.id]: archived },
	}));
	return archived;
}

describe("NAV-05 WorkspaceCard", () => {
	it("links an active card to its workspace", async () => {
		const { repo, workspace } = await seedCard({ displayName: "Fix the login" });
		renderCard(workspace, repo);
		const link = await screen.findByRole("link", { name: /Fix the login/ });
		expect(link.getAttribute("href")).toBe(`/repository/${repo.id}/workspace/${workspace.id}`);
	});

	it("shows an Unarchive button on an archived card and no workspace link", async () => {
		const { repo, workspace } = await seedCard({ displayName: "Old work" });
		renderCard(archive(workspace), repo);
		expect(await screen.findByRole("button", { name: "Unarchive" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: /Old work/ })).toBeNull();
	});

	it("treats a workspace with an archived date as archived before its state catches up", async () => {
		const { repo, workspace } = await seedCard({ displayName: "Old work" });
		renderCard({ ...workspace, state: "ready", archivedAt: 10 }, repo);
		expect(await screen.findByRole("button", { name: "Unarchive" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: /Old work/ })).toBeNull();
	});

	it("calls unarchive from the archived card", async () => {
		const { repo, workspace } = await seedCard({ displayName: "Old work" });
		if (test === undefined) throw new Error("Create the test container first.");
		const unarchive = vi
			.spyOn(test.container.actions.workspaces, "unarchive")
			.mockResolvedValue(ok({ needsBranchName: false, uncommittedChangesLost: false }));
		renderCard(archive(workspace), repo);
		fireEvent.click(await screen.findByRole("button", { name: "Unarchive" }));
		await waitFor(() =>
			expect(unarchive).toHaveBeenCalledWith(workspace.id, {
				branchName: null,
				clearChats: false,
			}),
		);
	});

	it("opens the archived workspace in Finder and copies its path", async () => {
		const { repo, workspace } = await seedCard({ displayName: "Old work" });
		if (test === undefined) throw new Error("Create the test container first.");
		const openIn = vi
			.spyOn(test.container.actions.workspaces, "openIn")
			.mockResolvedValue(ok(undefined));
		const copyText = vi
			.spyOn(test.container.actions.app, "copyText")
			.mockResolvedValue(ok(undefined));
		renderCard(archive(workspace), repo);
		fireEvent.click(await screen.findByRole("button", { name: "Open in Finder" }));
		fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
		await waitFor(() => expect(openIn).toHaveBeenCalledWith(workspace.id, "Finder"));
		await waitFor(() => expect(copyText).toHaveBeenCalledWith(workspace.path));
	});

	it("shows the repository only when the Display menu asks for it", async () => {
		const { repo, workspace } = await seedCard({ displayName: "Fix the login" });
		renderCard(workspace, repo, new Set(["lastActive"]));
		await screen.findByRole("link", { name: /Fix the login/ });
		expect(screen.queryByText(repo.name)).toBeNull();
		cleanup();
		renderCard(workspace, repo, new Set(["repository"]));
		expect(await screen.findByText(repo.name)).toBeTruthy();
	});
});
