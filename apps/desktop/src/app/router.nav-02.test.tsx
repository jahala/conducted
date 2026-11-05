/**
 * @feature NAV-02 Routes and per-workspace URL state
 * Owns: the route tree, the workspace route's repair and chat-tab restore, and the repository settings route.
 * Behaviour: ui-map.md 2 (routes and search params), services-map.md 6 (a deleted or archived workspace or chat
 * sends the route Home).
 * Test first: navigating to /all-workspaces renders the Home screen area; "/" renders the centre empty state.
 */
import { ok, type RepoId, type SessionId, type WorkspaceId } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Container } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import type { Repo, Workspace } from "../core/model.ts";
import { RepoService, type RepoServiceDeps } from "../core/services/repo.ts";
import "../test/dom-polyfills.ts";
import { useOverlayStore } from "./overlay-store.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

afterEach(cleanup);
beforeEach(() => useOverlayStore.getState().close());

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

function testContainer(fixture: Fixture): {
	container: Container;
	setActiveSession: ReturnType<typeof vi.fn>;
} {
	const repos = fixture.repos ?? [];
	const workspaces = fixture.workspaces ?? [];
	const sessions = fixture.sessions ?? [];
	const settings = {
		store: createStore<{ values: Record<string, unknown> }>(() => ({ values: {} })),
		get: (key: string): unknown =>
			({
				left_panel_visible: true,
				left_panel_width: 256,
				keybinding_overrides_v1: "",
				dashboard_enabled: false,
			})[key],
		set: async () => undefined,
	};
	const repoService = new RepoService({} as RepoServiceDeps);
	repoService.store.setState({
		loaded: true,
		reposById: Object.fromEntries(repos.map((row) => [row.id, row])),
		order: repos.map((row) => row.id),
		configs: {},
	});
	const workspaceStore = createStore(() => ({
		loaded: true,
		workspacesById: Object.fromEntries(workspaces.map((row) => [row.id, row])),
		setup: {},
		archiving: {},
	}));
	const sessionsStore = createStore(() => ({
		loaded: true,
		sessions: Object.fromEntries(
			sessions.map((row) => [row.id, { id: row.id, workspaceId: row.workspaceId }]),
		),
		byWorkspace: {},
		liveStates: {},
		cancelling: {},
		events: {},
		progress: {},
		sending: {},
		openInteractions: {},
		viewingSessionId: null,
	}));
	const setActiveSession = vi.fn(async () => ok(undefined));
	return {
		container: {
			services: {
				repo: repoService,
				workspace: { store: workspaceStore },
				sessions: { store: sessionsStore },
				settings,
				sections: { store: createStore(() => ({ loaded: true, sections: [] })) },
			},
			actions: { workspaces: { setActiveSession } },
		} as unknown as Container,
		setActiveSession,
	};
}

async function openApp(path: string, fixture: Fixture = {}) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	const { container, setActiveSession } = testContainer(fixture);
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return { router, setActiveSession };
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
		expect(within(main).getByText("Not built yet: NAV-05")).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
	});

	it("renders a repository settings page without the sidebar", async () => {
		await openApp("/settings/repos/r1/scripts");
		expect(await screen.findByText("Settings")).toBeTruthy();
		expect(screen.getByText("Not built yet: SET-02")).toBeTruthy();
		expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
	});
});

describe("NAV-02 route repair", () => {
	it("sends an archived workspace to Home", async () => {
		const { router } = await openApp("/repository/r1/workspace/w1?tab=pr", {
			repos: [repo("r1")],
			workspaces: [workspace({ id: "w1", state: "archived", archivedAt: 10 })],
		});

		await waitFor(() => expect(router.state.location.pathname).toBe("/all-workspaces"));
		expect(await screen.findByText("Home")).toBeTruthy();
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
