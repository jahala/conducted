import { appError, err, ok, type RepoId, type Result, type WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewWorkspaceInput } from "../core/api.ts";
import { ServicesProvider } from "../core/context.tsx";
import type { Repo, Section, Workspace } from "../core/model.ts";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { Toaster, toast } from "../ui/Toast.tsx";
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
	remoteFileSyncEnabled: false,
	host: { kind: "local" },
	displayName: null,
	targetBranch: "main",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55_000,
	pinnedAt: null,
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

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	toast.dismiss();
	test.close();
});

function makeContainer(sectionRows: readonly Section[] = []) {
	const { services, actions } = test.container;
	services.repo.store.setState({
		loaded: true,
		reposById: { [repo.id]: repo },
		order: [repo.id],
		configs: {},
	});
	services.sections.store.setState({ loaded: true, sections: sectionRows });
	services.favoriteModels.store.setState({ loaded: true, favorites: [] });
	// The dialog's model menu is the composer's: it reads the agent catalogue and the favourites.
	services.agentCatalog.store.setState({
		installs: { state: "loading" },
		models: {},
		slashCommands: {},
	});
	const create = vi.fn(
		async (_input: NewWorkspaceInput): Promise<Result<Workspace>> => ok(workspace),
	);
	const retrySetup = vi.fn(async () => ok(undefined));
	const recoverPrompt = vi.fn(async () => ok({ text: "Fix the login bug", attachmentPaths: [] }));
	vi.spyOn(actions.workspaces, "create").mockImplementation(create);
	vi.spyOn(actions.workspaces, "retrySetup").mockImplementation(retrySetup);
	vi.spyOn(actions.workspaces, "recoverPrompt").mockImplementation(recoverPrompt);
	vi.spyOn(actions.app, "pickFolder").mockResolvedValue(ok(null));
	vi.spyOn(actions.projects, "addLocal").mockResolvedValue(ok(repo));
	return {
		container: test.container,
		create,
		retrySetup,
		recoverPrompt,
		workspaceStore: services.workspace.store,
	};
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
			<Toaster />
		</ServicesProvider>,
	);
	await router.load();
	return { router, create, retrySetup, recoverPrompt, workspaceStore };
}

/**
 * Opens the create-from picker (closed by default, as in Conductor's dialog) and picks its "Branches"
 * tab.
 */
async function chooseBranchSource() {
	fireEvent.click(screen.getByRole("button", { name: "Show or hide the create-from picker" }));
	// The sources are Conductor's tabs ("PRs", "Branches", "Issues") in place of a select.
	const group = await screen.findByRole("radiogroup", { name: "Create from" });
	fireEvent.click(within(group).getByRole("radio", { name: "Branches" }));
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

	it("describes itself in Conductor's words, for screen readers only", async () => {
		await renderCreatePage();

		const description = await screen.findByText(
			"Draft the first message, then create and send it.",
		);
		expect(description.closest("[style]")?.getAttribute("style")).toContain("clip");
		expect(screen.getByRole("dialog").getAttribute("aria-describedby")).toBe(description.id);
	});

	it("replaces the create page, as Conductor replaces its new tab", async () => {
		const { router } = await renderCreatePage();

		fireEvent.click(await screen.findByRole("button", { name: "Create workspace" }));

		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/repository/${repo.id}/workspace/${workspace.id}`,
			),
		);
		expect(router.history.canGoBack()).toBe(false);
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

	// Conductor makes the workspace ready when its setup script fails and says so in an error toast
	// (main @1101155); the creation itself succeeded.
	it("opens the new workspace and says its setup script failed", async () => {
		const { create, workspaceStore } = await renderCreatePage();
		create.mockImplementationOnce(async () => {
			workspaceStore.setState({
				setupRuns: {
					[workspace.id]: {
						state: "failed",
						exitCode: 1,
						terminalId: null,
						logPath: "/logs/ws-1.log",
						log: "saved",
						interruptedReason: null,
					},
				},
			});
			return ok(workspace);
		});

		fireEvent.click(await screen.findByRole("button", { name: "Create workspace" }));

		expect(
			await screen.findByText("Setup script failed. Check the setup tab for logs."),
		).toBeTruthy();
		expect(await screen.findByText("Workspace opened")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Retry setup" })).toBeNull();
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

		// The section picker sits behind the dialog's "···" options, as Conductor's dialog keeps it.
		fireEvent.click(await screen.findByRole("button", { name: "More options" }));
		const trigger = await screen.findByRole("combobox", { name: "Create in section" });
		expect(trigger.textContent).toContain("Review");
		fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]?.[0].sectionId).toBe("s1");
	});
});

// Conductor's new-workspace dialog opens with no project too: its repository picker reads "Select
// repo" and its menu adds one (renderApp `Wwa` @10189388). The first-run screen is the other place.
describe("WS-01 Create with no projects yet", () => {
	it("opens the dialog on Select repo, whose menu adds a project", async () => {
		test.container.services.repo.store.setState({
			loaded: true,
			reposById: {},
			order: [],
			configs: {},
		});
		const rootRoute = createRootRoute({ component: () => <Outlet /> });
		const createPageRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/create",
			component: () => <CreateWorkspacePage />,
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([createPageRoute]),
			history: createMemoryHistory({ initialEntries: ["/create"] }),
		});
		render(
			<ServicesProvider container={test.container}>
				<RouterProvider router={router} />
			</ServicesProvider>,
		);
		await router.load();

		const picker = await screen.findByRole("button", { name: "Select repo" });
		expect(picker.textContent).toContain("Select repo");
		expect(screen.getByRole("textbox", { name: "First message" })).toBeTruthy();
		expect(screen.queryByText("Add a project to get started")).toBeNull();

		fireEvent.pointerDown(picker, { button: 0, ctrlKey: false });
		expect(await screen.findByRole("menuitem", { name: /Open project/ })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: /Open GitHub project/ })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: /Quick start/ })).toBeTruthy();
	});
});
