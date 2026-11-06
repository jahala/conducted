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

const section: Section = {
	id: "s1" as Section["id"],
	name: "Review",
	emoji: null,
	position: 0,
	collapsed: false,
	workspaceIds: [],
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

function makeContainer(sectionRows: readonly Section[] = []) {
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
				default_model: "",
				default_claude_effort_level: "",
				default_fast_mode: false,
				default_plan_mode: false,
				tool_approvals_enabled: false,
			})[key] as T,
		set: async () => ok(undefined),
	};
	const sections = createStore<{ loaded: boolean; sections: readonly Section[] }>(() => ({
		loaded: true,
		sections: sectionRows,
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
	const composerStore = createStore<{
		drafts: Record<string, { text: string; attachmentPaths: string[] }>;
	}>(() => ({ drafts: {} }));
	const composer = {
		store: composerStore,
		loadDraft: async (id: string) => {
			const existing = composerStore.getState().drafts[id];
			if (existing !== undefined) return ok(existing);
			const draft = { text: "", attachmentPaths: [] };
			composerStore.setState((state) => ({ drafts: { ...state.drafts, [id]: draft } }));
			return ok(draft);
		},
		saveDraft: (id: string, draft: { text: string; attachmentPaths: string[] }) =>
			composerStore.setState((state) => ({ drafts: { ...state.drafts, [id]: draft } })),
		clearDraft: async (id: string) => {
			composerStore.setState((state) => {
				const drafts = { ...state.drafts };
				delete drafts[id];
				return { drafts };
			});
			return ok(undefined);
		},
	};
	const container = {
		services: {
			repo: repoService,
			settings,
			sections: { store: sections },
			workspace: { store: workspaceStore },
			composer,
		},
		actions: {
			workspaces: { create, retrySetup, recoverPrompt },
			app: { pickFolder: async () => ok(null) },
			projects: { addLocal: async () => ok(repo) },
		},
	} as unknown as Container;
	return { container, create, retrySetup, recoverPrompt, workspaceStore };
}

async function renderCreatePage(path = "/create", sectionRows: readonly Section[] = []) {
	const { container, create, retrySetup, recoverPrompt, workspaceStore } =
		makeContainer(sectionRows);
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
		history: createMemoryHistory({ initialEntries: [path] }),
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

/** Picks "Branch" in the "Create from" select with the keyboard, as app-12's select tests do. */
async function chooseBranchSource() {
	fireEvent.keyDown(screen.getByRole("combobox", { name: "Create from" }), { key: "Enter" });
	fireEvent.keyDown(await screen.findByRole("option", { name: "Branch" }), { key: "Enter" });
}

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

	it("starts a chat on the model default when the settings leave model and effort empty", async () => {
		const { create } = await renderCreatePage();
		fireEvent.click(await screen.findByRole("button", { name: "Create workspace" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]?.[0].config).toMatchObject({ model: "default", effort: "high" });
		expect(create.mock.calls[0]?.[0].prompt).toBe("");
	});

	it("creates from the named branch", async () => {
		const { create } = await renderCreatePage();
		await screen.findByRole("button", { name: "Create workspace" });
		await chooseBranchSource();
		fireEvent.change(await screen.findByLabelText("Branch name"), {
			target: { value: "  feature/login  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]?.[0].from).toEqual({ kind: "branch", name: "feature/login" });
	});

	it("refuses to create from a branch without a name", async () => {
		const { create } = await renderCreatePage();
		await screen.findByRole("button", { name: "Create workspace" });
		await chooseBranchSource();
		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		expect(await screen.findByText("Enter the branch to start from.")).toBeTruthy();
		expect(create).not.toHaveBeenCalled();
	});

	it("creates once when the button is pressed twice before the first create ends", async () => {
		const { create } = await renderCreatePage();
		let finish: (result: Result<Workspace>) => void = () => {};
		create.mockImplementationOnce(
			() => new Promise<Result<Workspace>>((resolve) => (finish = resolve)),
		);
		const button = await screen.findByRole("button", { name: "Create workspace" });

		fireEvent.click(button);
		fireEvent.click(button);
		finish(ok(workspace));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
	});

	it("toasts the warnings a retried setup returned", async () => {
		const warning = vi.spyOn(toast, "warning");
		const { create, workspaceStore } = await renderCreatePage();
		create.mockImplementationOnce(async () => {
			workspaceStore.setState({ lastFailedCreate: { ...workspace, state: "failed" } });
			return err(appError("git_failed", "fatal: cannot create worktree"));
		});
		fireEvent.click(await screen.findByRole("button", { name: "Create workspace" }));
		const retry = await screen.findByRole("button", { name: "Retry setup" });
		workspaceStore.setState({ warnings: { [workspace.id]: ["Setup script was skipped."] } });

		fireEvent.click(retry);

		await waitFor(() => expect(warning).toHaveBeenCalledWith("Setup script was skipped."));
		warning.mockRestore();
	});
});

describe("NAV-04 Create in section", () => {
	it("starts with the section named in the URL and creates the workspace there", async () => {
		const { create } = await renderCreatePage("/create?section=s1", [section]);

		const trigger = await screen.findByRole("combobox", { name: "Create in section" });
		expect(trigger.textContent).toContain("Review");
		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]?.[0].sectionId).toBe("s1");
	});
});
