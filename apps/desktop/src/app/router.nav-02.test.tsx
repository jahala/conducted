/**
 * @feature NAV-02 Routes and per-workspace URL state
 * Owns: the route tree, the workspace route's repair and chat-tab restore, and the repository settings route.
 * Behaviour: ui-map.md 2 (routes and search params), services-map.md 6 (a deleted workspace or chat, or one
 * being archived, sends the route Home; an archived one stays open, as in Conductor, renderApp @10132431).
 * Test first: navigating to /all-workspaces renders the Home screen area; "/" renders the centre empty state.
 */
import { ok, type RepoId, type SessionId, type WorkspaceId } from "@conducted/shared";
import { createMemoryHistory, type RouterHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import type { Repo, Workspace } from "../core/model.ts";
import { CommandRegistryProvider, createCommandRegistry } from "./command-dispatcher.ts";
import { SAVED_LOCATION_KEY } from "./navigation-history.ts";
import { useOverlayStore } from "./overlay-store.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";
import { createShellContainer } from "./shell-test-support.ts";

afterEach(cleanup);
beforeEach(() => {
	useOverlayStore.getState().close();
	window.localStorage.clear();
});

function repo(id: string): Repo {
	return {
		id: id as Repo["id"],
		name: id,
		rootPath: `/repos/${id}`,
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
		displayOrder: 0,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
	};
}

function workspace({
	id,
	...overrides
}: Omit<Partial<Workspace>, "id"> & { id: string }): Workspace {
	return {
		id: id as WorkspaceId,
		repoId: "r1" as RepoId,
		directoryName: id,
		path: `/repos/${id}`,
		branch: `branch-${id}`,
		branchIsPlaceholder: false,
		host: { kind: "local" },
		displayName: null,
		targetBranch: "main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 50000,
		pinnedAt: null,
		linkedPaths: [],
		prNumber: null,
		prTitle: null,
		prDescription: null,
		archiveCommit: null,
		archivedAt: null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

interface Fixture {
	repos?: Repo[];
	workspaces?: Workspace[];
	sessions?: { id: string; workspaceId: string }[];
}

async function openApp(path: string | RouterHistory, fixture: Fixture = {}) {
	const router = createAppRouter(
		typeof path === "string" ? createMemoryHistory({ initialEntries: [path] }) : path,
	);
	const registry = createCommandRegistry();
	const { container } = createShellContainer(fixture);
	const setActiveSession = vi.spyOn(container.actions.workspaces, "setActiveSession");
	const quit = vi.spyOn(container.actions.app, "quit");
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<CommandRegistryProvider registry={registry}>
					<RouterProvider router={router} />
				</CommandRegistryProvider>
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return { router, setActiveSession, registry, quit, container };
}

describe("NAV-02 route tree", () => {
	it("/ shows the centre empty state inside the shell", async () => {
		await openApp("/");
		expect(await screen.findByRole("heading", { name: "Run agents side by side" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("/all-workspaces renders the Home screen area inside the shell", async () => {
		await openApp("/all-workspaces");
		const main = await screen.findByRole("main");
		expect(await within(main).findByText("No matching workspaces")).toBeTruthy();
		// Home has no title in its strip, as Conductor's Home has none (D098).
		expect(within(main).queryByRole("heading", { name: "Home" })).toBeNull();
		expect(within(main).getByRole("searchbox", { name: "Search" })).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("renders a repository settings page without the sidebar", async () => {
		await openApp("/settings/repos/r1/scripts");
		expect(await screen.findByRole("navigation", { name: "Settings" })).toBeTruthy();
		expect(await screen.findByText("Pick a project")).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});
});

describe("NAV-02 last location", () => {
	it("reopens the saved workspace and its search when the app starts at /", async () => {
		window.localStorage.setItem(
			SAVED_LOCATION_KEY,
			JSON.stringify({ workspaceId: "w1", search: { tab: "pr", pr: 42 } }),
		);
		const { router } = await openApp("/", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w1" })],
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/repository/r1/workspace/w1"));
		expect(router.state.location.search).toMatchObject({ tab: "pr", pr: 42 });
	});

	it("skips an archived saved workspace and opens the most recent ready one", async () => {
		window.localStorage.setItem(
			SAVED_LOCATION_KEY,
			JSON.stringify({ workspaceId: "w1", search: { tab: "pr", pr: 42 } }),
		);
		const { router } = await openApp("/", {
			repos: [repo("r1")],
			workspaces: [
				workspace({ id: "w1", state: "archived", archivedAt: 10, lastActivityAt: 900 }),
				workspace({ id: "w2", lastActivityAt: 500 }),
				workspace({ id: "w3", lastActivityAt: 700 }),
			],
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/repository/r1/workspace/w3"));
		expect(router.state.location.search).toEqual({});
	});

	it("saves the workspace route once it settles", async () => {
		await openApp("/repository/r1/workspace/w1?tab=file&path=src/a.ts&gitTab=changes", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w1" })],
		});

		await waitFor(() => {
			const saved = window.localStorage.getItem(SAVED_LOCATION_KEY);
			expect(saved).not.toBeNull();
			expect(JSON.parse(saved ?? "null")).toMatchObject({
				workspaceId: "w1",
				search: { tab: "file", path: "src/a.ts", gitTab: "changes" },
			});
		});
	});
});

describe("NAV-02 route repair", () => {
	it("keeps an archived workspace open, as Conductor does", async () => {
		const { router } = await openApp("/repository/r1/workspace/w1?tab=file&path=a.ts", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w1", state: "archived", archivedAt: 10 })],
		});

		const main = await screen.findByRole("main");
		expect(await within(main).findByText("Workspace archived")).toBeTruthy();
		expect(router.state.location.pathname).toBe("/repository/r1/workspace/w1");
	});

	it("sends a workspace that is being archived to Home", async () => {
		const { router } = await openApp("/repository/r1/workspace/w1?tab=pr", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w1", state: "archiving" })],
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/all-workspaces"));
		const main = await screen.findByRole("main");
		// Home has no title (D098); its toolbar's Search shows the screen is Home.
		expect(await within(main).findByRole("searchbox", { name: "Search" })).toBeTruthy();
	});

	it("sends a deleted workspace to Home when other workspaces are known", async () => {
		const { router } = await openApp("/repository/r1/workspace/gone?tab=pr", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w2" })],
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/all-workspaces"));
	});

	it("sends a deleted chat to Home", async () => {
		const { router } = await openApp("/repository/r1/workspace/w1?tab=session&sessionId=gone", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w1" })],
			sessions: [{ id: "s1", workspaceId: "w1" }],
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/all-workspaces"));
	});
});

describe("NAV-02 per-workspace URL state", () => {
	it("reopens the stored chat tab when the workspace address has no search", async () => {
		const { router } = await openApp("/repository/r1/workspace/w1", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w1", activeSessionId: "s1" as SessionId })],
			sessions: [{ id: "s1", workspaceId: "w1" }],
		});

		await waitFor(() =>
			expect(router.state.location.search).toMatchObject({ tab: "session", sessionId: "s1" }),
		);
	});

	it("stores the chat tab when the search names one", async () => {
		const { setActiveSession } = await openApp(
			"/repository/r1/workspace/w1?tab=session&sessionId=s1",
			{
				repos: [repo("r1")],
				workspaces: [workspace({ id: "w1" })],
				sessions: [{ id: "s1", workspaceId: "w1" }],
			},
		);

		await waitFor(() => expect(setActiveSession).toHaveBeenCalledWith("w1", "s1"));
	});

	it("keeps the pull request number in the URL", async () => {
		const { router } = await openApp("/repository/r1/workspace/w1?tab=pr&pr=42", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w1" })],
		});

		expect(router.state.location.search).toMatchObject({ tab: "pr", pr: 42 });
	});
});

describe("NAV-02 back and forward commands", () => {
	it("moves through history with nav.back and nav.forward", async () => {
		const { router, registry } = await openApp(
			createMemoryHistory({ initialEntries: ["/all-workspaces", "/backlog"] }),
		);

		expect(router.state.location.pathname).toBe("/backlog");
		registry.run("nav.back");
		await waitFor(() => expect(router.state.location.pathname).toBe("/all-workspaces"));

		registry.run("nav.forward");
		await waitFor(() => expect(router.state.location.pathname).toBe("/backlog"));
	});

	it("follows the Cmd+[ key press, because the dispatcher is mounted at the root", async () => {
		const { router } = await openApp(
			createMemoryHistory({ initialEntries: ["/all-workspaces", "/backlog"] }),
		);

		fireEvent.keyDown(document.body, { key: "[", metaKey: true });
		await waitFor(() => expect(router.state.location.pathname).toBe("/all-workspaces"));
	});
});

describe("PLAT-15 Quit from the window", () => {
	it("runs the Quit command, as Cmd+Q in the window and Quit in the palette do", async () => {
		const { registry, quit } = await openApp("/");

		expect(registry.run("app.quit")).toBe(true);
		expect(quit).toHaveBeenCalledTimes(1);

		fireEvent.keyDown(document.body, { key: "q", metaKey: true });
		await waitFor(() => expect(quit).toHaveBeenCalledTimes(2));
	});
});

describe("Navigation and workspace commands reach their screens", () => {
	it("Go to Home opens Home from another route", async () => {
		const { router, registry } = await openApp("/create");

		act(() => expect(registry.run("nav.home")).toBe(true));

		await waitFor(() => expect(router.state.location.pathname).toBe("/all-workspaces"));
	});

	it("Create new workspace opens the create page", async () => {
		const { router, registry } = await openApp("/all-workspaces");

		act(() => expect(registry.run("workspace.create")).toBe(true));

		await waitFor(() => expect(router.state.location.pathname).toBe("/create"));
	});

	it("View archived workspaces opens Home with Only archived, and clears its search", async () => {
		const live = workspace({ id: "w-live", displayName: "Live work" });
		const old = workspace({
			id: "w-old",
			displayName: "Old work",
			state: "archived",
			archivedAt: 10,
		});
		const { router, registry } = await openApp("/", {
			repos: [repo("r1")],
			workspaces: [live, old],
		});
		await screen.findByText("Run agents side by side");

		act(() => expect(registry.run("nav.viewArchived")).toBe(true));

		expect(await screen.findByText("Old work")).toBeTruthy();
		expect(screen.queryByText("Live work")).toBeNull();
		expect(router.state.location.pathname).toBe("/all-workspaces");
	});

	it("the sidebar's row commands act on the open workspace", async () => {
		const live = workspace({ id: "w-live", displayName: "Live work" });
		const { registry, container } = await openApp("/repository/r1/workspace/w-live", {
			repos: [repo("r1")],
			workspaces: [live],
		});
		const copy = vi.spyOn(container.actions.app, "copyText").mockResolvedValue(ok(undefined));

		act(() => expect(registry.run("workspace.copyLink")).toBe(true));
		await waitFor(() => expect(copy).toHaveBeenCalledWith("conducted://workspace?id=w-live"));

		act(() => expect(registry.run("workspace.createSection")).toBe(true));
		expect(await screen.findByRole("dialog", { name: "New section" })).toBeTruthy();

		const archive = vi
			.spyOn(container.actions.workspaces, "archive")
			.mockResolvedValue(ok(undefined));
		act(() => expect(registry.run("workspace.archive")).toBe(true));
		await waitFor(() => expect(archive).toHaveBeenCalledWith("w-live", { deleteBranch: false }));
	});
});

describe("PRJ-01 adding a project opens a workspace in it, as Conductor does", () => {
	// Conductor's repo-created step (renderApp @1713146, autoCreateWorkspace) creates the new
	// project's first workspace with the default chat settings and opens it.
	const added = repo("app");
	const first = workspace({ id: "w-first", repoId: added.id });

	it("Open project: picks the folder, adds it, then opens a new workspace in it", async () => {
		const { router, container } = await openApp("/");
		vi.spyOn(container.actions.app, "pickFolder").mockResolvedValue(ok("/repos/app"));
		vi.spyOn(container.actions.projects, "addLocal").mockResolvedValue(ok(added));
		const create = vi
			.spyOn(container.actions.workspaces, "createFirst")
			.mockResolvedValue(ok(first));

		fireEvent.click(await screen.findByRole("button", { name: /^Open project$/ }));

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/repository/app/workspace/w-first"),
		);
		expect(create).toHaveBeenCalledWith(added.id);
	});

	it("Open GitHub project: a finished clone opens a new workspace in the clone", async () => {
		const { router, container } = await openApp("/");
		vi.spyOn(container.actions.projects, "clone").mockResolvedValue(ok(added));
		vi.spyOn(container.actions.workspaces, "createFirst").mockResolvedValue(ok(first));

		fireEvent.click(await screen.findByRole("button", { name: /Open GitHub project/ }));
		fireEvent.change(await screen.findByLabelText("Repository URL"), {
			target: { value: "https://github.com/octo/app.git" },
		});
		fireEvent.change(screen.getByLabelText("Location"), { target: { value: "/repos" } });
		fireEvent.click(screen.getByRole("button", { name: /Clone repository/ }));

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/repository/app/workspace/w-first"),
		);
	});
});
