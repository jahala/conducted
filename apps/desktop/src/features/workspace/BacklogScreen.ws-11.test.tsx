/**
 * @feature WS-11 Backlog workspaces: save now, start later
 * Owns: the backlog screen's rows, their Unstarted label, Start and Remove, and Cmd+Enter.
 * Behaviour: ui-map.md 3.1 (Workspace actions offers Start), 3.8 (Unstarted), 5.4 (Cmd+Enter).
 * Test first: pressing Cmd+Enter starts the selected backlog workspace.
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
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Workspace } from "../../core/model.ts";
import { FIRST_CHAT_APP_TOOLS } from "../../core/services/workspace.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";
import { BacklogScreen } from "./BacklogScreen.tsx";

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

async function renderBacklog() {
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
	const backlogRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/backlog",
		component: () => <BacklogScreen />,
	});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <div>Workspace opened</div>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([backlogRoute, workspaceRoute]),
		history: createMemoryHistory({ initialEntries: ["/backlog"] }),
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
	return { container, entry: saved.value, repo };
}

describe("WS-11 BacklogScreen", () => {
	it("lists a saved workspace with its Unstarted label", async () => {
		await renderBacklog();

		expect(screen.getByText("Fix the login bug")).toBeTruthy();
		expect(screen.getByText(/Unstarted/)).toBeTruthy();
	});

	it("starts the workspace from its row", async () => {
		const { container, entry, repo } = await renderBacklog();
		const start = vi
			.spyOn(container.actions.workspaces, "startFromBacklog")
			.mockResolvedValue(ok({ ...workspace, id: entry.id, repoId: repo.id }));

		fireEvent.click(screen.getByRole("button", { name: "Start" }));

		await waitFor(() => expect(start).toHaveBeenCalledWith(entry.id));
		await screen.findByText("Workspace opened");
	});

	it("starts the workspace from the Workspace actions menu", async () => {
		const { container, entry, repo } = await renderBacklog();
		const start = vi
			.spyOn(container.actions.workspaces, "startFromBacklog")
			.mockResolvedValue(ok({ ...workspace, id: entry.id, repoId: repo.id }));

		const trigger = screen.getByRole("button", { name: "Workspace actions" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Start" }));

		await waitFor(() => expect(start).toHaveBeenCalledWith(entry.id));
	});

	it("starts the selected workspace when Cmd+Enter is pressed", async () => {
		const { container, entry, repo } = await renderBacklog();
		const start = vi
			.spyOn(container.actions.workspaces, "startFromBacklog")
			.mockResolvedValue(ok({ ...workspace, id: entry.id, repoId: repo.id }));

		fireEvent.keyDown(screen.getByRole("heading", { name: "Backlog" }), {
			key: "Enter",
			metaKey: true,
		});

		await waitFor(() => expect(start).toHaveBeenCalledWith(entry.id));
	});

	it("removes a saved workspace from the actions menu", async () => {
		const { container, entry } = await renderBacklog();

		const trigger = screen.getByRole("button", { name: "Workspace actions" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from backlog" }));

		await waitFor(() =>
			expect(container.services.workspace.store.getState().backlogById[entry.id]).toBeUndefined(),
		);
		expect(screen.getByText("No workspaces in the backlog")).toBeTruthy();
	});
});
