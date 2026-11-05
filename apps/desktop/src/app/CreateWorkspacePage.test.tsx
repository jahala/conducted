import { appError, err, ok, type RepoId, type Result, type WorkspaceId } from "@conducted/shared";
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
import { createStore } from "zustand/vanilla";
import type { NewWorkspaceInput } from "../core/api.ts";
import type { Container } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import type { Repo, Section, Workspace } from "../core/model.ts";
import { RepoService, type RepoServiceDeps } from "../core/services/repo.ts";
import "../test/dom-polyfills.ts";
import { toast } from "../ui/Toast.tsx";
import { CreateWorkspacePage } from "./CreateWorkspacePage.tsx";

const repo: Repo = {
	id: "r1" as RepoId,
	name: "Project",
	rootPath: "/repo",
	remoteUrl: "git@github.com:me/project.git",
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1000,
	updatedAt: 1000,
};

const workspace: Workspace = {
	id: "w1" as WorkspaceId,
	repoId: repo.id,
	directoryName: "oslo",
	path: "/Users/test/conducted/workspaces/Project/oslo",
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

function makeContainer() {
	const repoService = new RepoService({} as RepoServiceDeps);
	repoService.store.setState({
		loaded: true,
		reposById: { [repo.id]: repo },
		order: [repo.id],
		configs: {},
	});
	const settings = {
		store: createStore<{ values: Record<string, unknown> }>(() => ({ values: {} })),
		get: <T,>(key: string): T =>
			({
				default_model: "default",
				default_claude_effort_level: "high",
				default_fast_mode: false,
				default_plan_mode: false,
				tool_approvals_enabled: false,
			})[key] as T,
		set: async () => undefined,
	};
	const sections = createStore<{ loaded: boolean; sections: readonly Section[] }>(() => ({
		loaded: true,
		sections: [],
	}));
	const create = vi.fn(
		async (_input: NewWorkspaceInput): Promise<Result<Workspace>> => ok(workspace),
	);
	const retrySetup = vi.fn(async () => ok(undefined));
	const recoverPrompt = vi.fn(async () => ok({ text: "Fix the login bug", attachmentPaths: [] }));
	const workspaceStore = createStore<{
		lastFailedCreate: Workspace | null;
		warnings: Record<string, readonly string[]>;
	}>(() => ({ lastFailedCreate: null, warnings: {} }));
	const container = {
		services: {
			repo: repoService,
			settings,
			sections: { store: sections },
			workspace: { store: workspaceStore },
		},
		actions: {
			workspaces: { create, retrySetup, recoverPrompt },
			app: { pickFolder: async () => ok(null) },
			projects: { addLocal: async () => ok(repo) },
		},
	} as unknown as Container;
	return { container, create, retrySetup, recoverPrompt, workspaceStore };
}

async function renderCreatePage() {
	const { container, create, retrySetup, recoverPrompt, workspaceStore } = makeContainer();
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const createPageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/create",
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
	render(
		<ServicesProvider container={container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
	await router.load();
	return { router, create, retrySetup, recoverPrompt, workspaceStore };
}

afterEach(cleanup);

describe("WS-01 CreateWorkspacePage", () => {
	it("creates the workspace with the picked repository and prompt, then opens it", async () => {
		const { router, create } = await renderCreatePage();

		fireEvent.change(await screen.findByLabelText("First message"), {
			target: { value: "Fix the login bug" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]?.[0]).toMatchObject({
			repoId: repo.id,
			prompt: "Fix the login bug",
			from: { kind: "default" },
			sectionId: null,
		});
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/repository/${repo.id}/workspace/${workspace.id}`,
			),
		);
	});

	it("toasts the warnings a creation returned", async () => {
		const warning = vi.spyOn(toast, "warning");
		const { create, workspaceStore } = await renderCreatePage();
		workspaceStore.setState({ warnings: { [workspace.id]: ["Could not fetch, using cached."] } });

		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(warning).toHaveBeenCalledWith("Could not fetch, using cached."));
		warning.mockRestore();
	});

	it("offers Retry setup and Recover prompt after a failed creation", async () => {
		const { create, retrySetup, recoverPrompt, workspaceStore, router } = await renderCreatePage();
		create.mockImplementationOnce(async () => {
			workspaceStore.setState({ lastFailedCreate: { ...workspace, state: "failed" } });
			return err(appError("git_failed", "fatal: cannot create worktree"));
		});

		fireEvent.click(await screen.findByRole("button", { name: "Create workspace" }));

		const retry = await screen.findByRole("button", { name: "Retry setup" });
		fireEvent.click(screen.getByRole("button", { name: "Recover prompt" }));
		await waitFor(() => expect(recoverPrompt).toHaveBeenCalledWith(workspace.id));
		expect((screen.getByLabelText("First message") as HTMLTextAreaElement).value).toBe(
			"Fix the login bug",
		);

		fireEvent.click(retry);
		await waitFor(() => expect(retrySetup).toHaveBeenCalledWith(workspace.id));
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/repository/${repo.id}/workspace/${workspace.id}`,
			),
		);
	});
});
