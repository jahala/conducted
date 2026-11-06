/**
 * @feature WS-02 Create from a branch, PR or issue
 * Owns: the create-from picker's branch, pull request and issue lists, its Cmd+I toggle and the
 * messages it shows when a source was not loaded.
 * Behaviour: ui-map.md 3.9 (new workspace flow, create-from lists) and 5.4 (Cmd+I).
 * Test first: picking a pull request sends its number as the create-from choice.
 */
import { ok, type RepoId, type WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import type { Workspace } from "../core/model.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../test/container.ts";
import { toast } from "../ui/Toast.tsx";
import { CreateWorkspacePage } from "./CreateWorkspacePage.tsx";
import { CommandDispatcher } from "./command-dispatcher.ts";

const workspace: Workspace = {
	id: "w1" as WorkspaceId,
	repoId: "r1" as RepoId,
	directoryName: "oslo",
	path: "/workspaces/Project/oslo",
	branch: "oslo",
	branchIsPlaceholder: true,
	displayName: null,
	targetBranch: "main",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55_000,
	pinnedAt: null,
	notes: null,
	linkedPaths: [],
	prNumber: null,
	prTitle: null,
	prDescription: null,
	archiveCommit: null,
	archivedAt: null,
	activeSessionId: null,
	filesCopied: null,
	lastActivityAt: 1000,
	createdAt: 1000,
	updatedAt: 1000,
};

let test: TestContainer | null = null;
let client: QueryClient | null = null;

afterEach(() => {
	vi.restoreAllMocks();
	cleanup();
	client?.clear();
	client = null;
	test?.close();
	test = null;
});

async function renderPage() {
	test = createTestContainer();
	const repo = await seedRepo(test.container, {
		name: "Project",
		rootPath: "/repo",
		remoteUrl: "git@github.com:me/project.git",
	});
	test.container.services.github.store.setState((state) => ({
		...state,
		access: {
			status: "ok",
			login: "me",
			host: "github.com",
			scopes: [],
			usesToken: false,
			gitProtocol: "https",
		},
	}));
	const create = vi
		.spyOn(test.container.actions.workspaces, "create")
		.mockResolvedValue(ok({ ...workspace, repoId: repo.id }));
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const createPageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/create",
		validateSearch: (search: Record<string, unknown>) => search as { section?: string },
		component: () => <CreateWorkspacePage />,
	});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <div>Workspace opened</div>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([createPageRoute, workspaceRoute]),
		history: createMemoryHistory({ initialEntries: ["/create"] }),
	});
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ServicesProvider container={test.container}>
				<CommandDispatcher>
					<RouterProvider router={router} />
				</CommandDispatcher>
			</ServicesProvider>
		</QueryClientProvider>,
	);
	await router.load();
	await screen.findByRole("button", { name: "Create workspace" });
	return { container: test.container, create, repo };
}

async function chooseSource(label: string) {
	fireEvent.keyDown(screen.getByRole("combobox", { name: "Create from" }), { key: "Enter" });
	fireEvent.keyDown(await screen.findByRole("option", { name: label }), { key: "Enter" });
}

describe("WS-02 create from lists", () => {
	it("lists the repository's branches and puts the picked one in the field", async () => {
		const { container } = await renderPage();
		vi.spyOn(container.services.git, "listBranches").mockResolvedValue(
			ok(["main", "feature/login"]),
		);
		await chooseSource("Branch");

		fireEvent.click(screen.getByRole("button", { name: "Browse branches" }));
		const option = await screen.findByRole("option", { name: "feature/login" });
		fireEvent.click(option);

		expect((screen.getByLabelText("Branch name") as HTMLInputElement).value).toBe("feature/login");
	});

	it("picks a pull request and creates from its number", async () => {
		const { container, create } = await renderPage();
		vi.spyOn(container.services.github, "listPullRequests").mockResolvedValue(
			ok([
				{
					number: 42,
					title: "Add the login form",
					branch: "feature/login",
					authorLogin: "ada",
					authorAvatarUrl: null,
					state: "open",
					updatedAt: 1000,
				},
			]),
		);
		await chooseSource("Pull request");

		fireEvent.click(await screen.findByRole("option", { name: /#42 Add the login form/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]?.[0].from).toEqual({ kind: "pull_request", number: 42 });
	});

	it("picks a GitHub issue and creates from its provider and id", async () => {
		const { container, create } = await renderPage();
		vi.spyOn(container.services.github, "listIssues").mockResolvedValue(
			ok([
				{
					provider: "github",
					id: "7",
					identifier: "#7",
					title: "Login is broken",
					url: "https://github.com/me/project/issues/7",
					state: "open",
					branchName: null,
					updatedAt: 1000,
				},
			]),
		);
		await chooseSource("Issue");

		fireEvent.click(await screen.findByRole("option", { name: /#7 Login is broken/ }));
		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]?.[0].from).toEqual({
			kind: "issue",
			provider: "github",
			id: "7",
		});
	});

	it("says a pull request could not be loaded when none was picked", async () => {
		const { container, create } = await renderPage();
		vi.spyOn(container.services.github, "listPullRequests").mockResolvedValue(ok([]));
		const error = vi.spyOn(toast, "error");
		await chooseSource("Pull request");

		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		expect(error).toHaveBeenCalledWith("Could not load that pull request");
		expect(create).not.toHaveBeenCalled();
	});
});

describe("WS-02 Cmd+I", () => {
	it("hides and shows the create-from picker from a key press", async () => {
		await renderPage();
		const message = screen.getByLabelText("First message");

		expect(screen.getByRole("combobox", { name: "Create from" })).toBeTruthy();
		fireEvent.keyDown(message, { key: "i", metaKey: true });
		await waitFor(() => expect(screen.queryByRole("combobox", { name: "Create from" })).toBeNull());
		fireEvent.keyDown(message, { key: "i", metaKey: true });
		expect(await screen.findByRole("combobox", { name: "Create from" })).toBeTruthy();
	});
});
