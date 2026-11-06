/**
 * @feature WS-11 Backlog workspaces: save now, start later
 * Owns: the create page's Add to backlog and Start modes, their shortcut and their toasts.
 * Behaviour: ui-map.md 3.9 (buttons "Add to backlog" and "Start", toasts "Added to backlog") and
 * 5.4 (Alt+Enter adds to the backlog, Cmd+Enter starts a backlog workspace).
 * Test first: Alt+Enter on the create page saves the draft to the backlog.
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
import { FIRST_CHAT_APP_TOOLS } from "../core/services/workspace.ts";
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

const input = {
	from: { kind: "default" as const },
	prompt: "Fix the login bug",
	attachmentPaths: [],
	config: {
		agent: "claude" as const,
		model: "default",
		effort: "high" as const,
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: FIRST_CHAT_APP_TOOLS,
	},
	sectionId: null,
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

interface Page {
	container: TestContainer["container"];
	repoId: RepoId;
}

async function renderPage(options: { backlog?: string; path?: string } = {}): Promise<Page> {
	test = createTestContainer();
	const repo = await seedRepo(test.container, {
		name: "Project",
		rootPath: "/repo",
		remoteUrl: "git@github.com:me/project.git",
	});
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const createPageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/create",
		validateSearch: (search: Record<string, unknown>) =>
			search as { section?: string; backlog?: string },
		component: () => <CreateWorkspacePage />,
	});
	const backlogRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/backlog",
		component: () => <div>Backlog opened</div>,
	});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <div>Workspace opened</div>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([createPageRoute, backlogRoute, workspaceRoute]),
		history: createMemoryHistory({
			initialEntries: [
				options.path ??
					(options.backlog === undefined ? "/create" : `/create?backlog=${options.backlog}`),
			],
		}),
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
	await screen.findByRole("button", {
		name: options.backlog === undefined ? "Create workspace" : "Start",
	});
	return { container: test.container, repoId: repo.id };
}

function typePrompt(text: string) {
	fireEvent.change(screen.getByLabelText("First message"), { target: { value: text } });
}

describe("WS-11 create page backlog controls", () => {
	it("shows Add to backlog and saves the draft without creating a workspace", async () => {
		const { container } = await renderPage();
		const success = vi.spyOn(toast, "success");
		typePrompt("Fix the login bug");

		fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));

		await waitFor(() => expect(success).toHaveBeenCalledWith("Added to backlog"));
		expect(Object.values(container.services.workspace.store.getState().backlogById)).toHaveLength(
			1,
		);
		expect(
			Object.values(container.services.workspace.store.getState().workspacesById),
		).toHaveLength(0);
		await screen.findByText("Backlog opened");
	});

	it("saves the draft when Alt+Enter is pressed in the create page", async () => {
		const { container } = await renderPage();
		const success = vi.spyOn(toast, "success");
		typePrompt("Fix the login bug");

		fireEvent.keyDown(screen.getByLabelText("First message"), {
			key: "Enter",
			altKey: true,
		});

		await waitFor(() => expect(success).toHaveBeenCalledWith("Added to backlog"));
		expect(Object.values(container.services.workspace.store.getState().backlogById)).toHaveLength(
			1,
		);
	});

	it("hides Add to backlog when unstarted workspaces are turned off", async () => {
		const { container } = await renderPage();
		container.services.settings.store.setState((state) => ({
			...state,
			values: { ...state.values, unstarted_workspaces_enabled: false },
		}));

		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Add to backlog" })).toBeNull(),
		);
	});
});

describe("WS-11 start a backlog workspace", () => {
	it("opens the saved draft with a Start button", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container, {
			name: "Project",
			rootPath: "/repo",
			remoteUrl: "git@github.com:me/project.git",
		});
		await test.container.services.workspace.start();
		const saved = await test.container.actions.workspaces.addToBacklog({
			...input,
			repoId: repo.id,
		});
		if (!saved.ok) throw new Error(saved.error.message);
		const container = test.container;

		const rootRoute = createRootRoute({ component: () => <Outlet /> });
		const createPageRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/create",
			validateSearch: (search: Record<string, unknown>) =>
				search as { section?: string; backlog?: string },
			component: () => <CreateWorkspacePage />,
		});
		const workspaceRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/repository/$repositoryId/workspace/$workspaceId",
			component: () => <div>Workspace opened</div>,
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([createPageRoute, workspaceRoute]),
			history: createMemoryHistory({
				initialEntries: [`/create?backlog=${saved.value.id}`],
			}),
		});
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<ServicesProvider container={container}>
					<CommandDispatcher>
						<RouterProvider router={router} />
					</CommandDispatcher>
				</ServicesProvider>
			</QueryClientProvider>,
		);
		await router.load();

		await waitFor(() =>
			expect((screen.getByLabelText("First message") as HTMLTextAreaElement).value).toBe(
				"Fix the login bug",
			),
		);
		expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Add to backlog" })).toBeNull();
	});

	it("starts the saved workspace when Cmd+Enter is pressed", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container, {
			name: "Project",
			rootPath: "/repo",
			remoteUrl: "git@github.com:me/project.git",
		});
		await test.container.services.workspace.start();
		const saved = await test.container.actions.workspaces.addToBacklog({
			...input,
			repoId: repo.id,
		});
		if (!saved.ok) throw new Error(saved.error.message);
		const start = vi
			.spyOn(test.container.actions.workspaces, "startFromBacklog")
			.mockResolvedValue(ok({ ...workspace, id: saved.value.id, repoId: repo.id }));
		const container = test.container;

		const rootRoute = createRootRoute({ component: () => <Outlet /> });
		const createPageRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/create",
			validateSearch: (search: Record<string, unknown>) =>
				search as { section?: string; backlog?: string },
			component: () => <CreateWorkspacePage />,
		});
		const workspaceRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/repository/$repositoryId/workspace/$workspaceId",
			component: () => <div>Workspace opened</div>,
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([createPageRoute, workspaceRoute]),
			history: createMemoryHistory({
				initialEntries: [`/create?backlog=${saved.value.id}`],
			}),
		});
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<ServicesProvider container={container}>
					<CommandDispatcher>
						<RouterProvider router={router} />
					</CommandDispatcher>
				</ServicesProvider>
			</QueryClientProvider>,
		);
		await router.load();
		await screen.findByRole("button", { name: "Start" });

		fireEvent.keyDown(screen.getByLabelText("First message"), {
			key: "Enter",
			metaKey: true,
		});

		await waitFor(() => expect(start).toHaveBeenCalledWith(saved.value.id));
		await screen.findByText("Workspace opened");
	});
});
