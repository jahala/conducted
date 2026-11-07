/**
 * @feature NAV-02 Routes and per-workspace URL state
 * Owns: the route tree, the workspace route's repair and chat-tab restore, and the repository settings route.
 * Behaviour: ui-map.md 2 (routes and search params), services-map.md 6 (a deleted workspace or chat, or one
 * being archived, sends the route Home; an archived one stays open, as in Conductor, renderApp @10132431).
 * Test first: navigating to /all-workspaces renders the Home screen area; "/" renders the centre empty state.
 */
import type { RepoId, SessionId, WorkspaceId } from "@conducted/shared";
import { createMemoryHistory, type RouterHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
		notes: null,
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
	return { router, setActiveSession, registry };
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
		expect(await within(main).findByText("Home")).toBeTruthy();
		expect(await within(main).findByText("No matching workspaces")).toBeTruthy();
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
		expect(await within(main).findByText("Home")).toBeTruthy();
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
