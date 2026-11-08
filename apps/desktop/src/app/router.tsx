/**
 * @feature NAV-02 Routes
 * Owns: the route tree and the thin adapters that turn URL params into screen props.
 * Behaviour: ui-map.md 2 (route table), structure-map.md 3.2 (routes). Local routes only: the cloud routes
 * (login, routines, pull-requests, profile, org onboarding) are out of scope.
 * Routes:
 *   (main layout, with sidebar)  /                                                       last workspace route, else centre empty state
 *                                /repository/$repositoryId/workspace/$workspaceId   workspace, tab state in search
 *                                /all-workspaces                                       Home
 *                                /dashboard                                            Kanban board
 *                                /backlog                                              workspaces saved to start later
 *                                /create                                               new workspace page
 *   (no sidebar)                 /settings, /settings/user, /settings/user/$page, /diagnostics, /first-run-onboarding
 * Our design choices: user settings pages sit under `/settings/user/$page`, as Conductor's do, and
 * `/settings` and `/settings/user` redirect to `/settings/user/general`. Repository pages have their own route, `/settings/repos/$repoId/$page`, and pass
 * the page to the settings screen as `repo:<repoId>:<page>`. The workspace param is `$workspaceId`, not
 * `$localWorkspaceId`, because there are no cloud workspaces.
 * Must handle: an unknown address (NotFoundScreen); an error outside every screen's own boundary
 * (RouteErrorScreen with retry; a screen that throws is caught by its <NotBuiltYet>, which shows a short
 * card and clears on the next route key); the key, menu and deep-link listeners mounted once at the root
 * (CommandDispatcher); the appearance settings and their shortcuts applied once at the root, on every
 * route (AppearanceController); Cmd+, opening Settings from any route; a changed workspace id resets a failed screen (resetKey); invalid search values are dropped (see
 * workspace-search.ts); navigation never reloads the page; a workspace or chat that was deleted, or a workspace
 * being archived, sends the route Home instead of drawing a dead screen (an archived workspace stays open
 * read-only, as in Conductor); a bare workspace address reopens that workspace's
 * stored chat tab; "/" reopens the last workspace route and falls back to a ready one; the Go back and Go
 * forward commands follow the same history as the window buttons.
 * Test first: navigating to /all-workspaces renders the Home screen area; "/" renders the centre empty state.
 */
import type { RepoId, SessionId, WorkspaceId } from "@conducted/shared";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	type RouterHistory,
	RouterProvider,
	redirect,
	useNavigate,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useStore } from "zustand";
import { useServices } from "../core/context.tsx";
import { useActions } from "../core/hooks.ts";
import { canShowWorkspaceRoute } from "../core/workspace-open.ts";
import { NextUnreadController } from "../features/chat/NextUnreadButton.tsx";
import { DashboardScreen } from "../features/dashboard/DashboardScreen.tsx";
import { DiagnosticsScreen } from "../features/diagnostics/DiagnosticsScreen.tsx";
import { HomeScreen } from "../features/home/HomeScreen.tsx";
import { OnboardingScreen } from "../features/onboarding/OnboardingScreen.tsx";
import { AppearanceController } from "../features/settings/appearance/AppearanceController.tsx";
import { SettingsScreen } from "../features/settings/SettingsScreen.tsx";
import { BacklogScreen } from "../features/workspace/BacklogScreen.tsx";
import { WorkspaceScreen } from "../features/workspace/WorkspaceScreen.tsx";
import { type WorkspaceSearch, zWorkspaceSearch } from "../features/workspace/workspace-search.ts";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";
import { AppShell } from "./AppShell.tsx";
import { CreateWorkspacePage } from "./CreateWorkspacePage.tsx";
import { CommandDispatcher, useCommandHandler } from "./command-dispatcher.ts";
import { useDeepLinkOpener } from "./deep-link-routes.ts";
import { FileDropTarget } from "./FileDropTarget.tsx";
import { FullPage } from "./FullPage.tsx";
import { GlobalOverlays } from "./GlobalOverlays.tsx";
import { NoWorkspaceSelected } from "./NoWorkspaceSelected.tsx";
import { chooseRestoreTarget, readSavedLocation, saveSavedLocation } from "./navigation-history.ts";
import { NotFoundScreen, RouteErrorScreen } from "./route-states.tsx";

/**
 * The window controls' keyboard shortcuts, which follow the same history the buttons use, and the
 * root shortcuts that open a full page: Cmd+Shift+N the new workspace page, Cmd+, Settings. Cmd+Q
 * (and Quit in the palette) quits the way the menu's Quit does, asking first while agents work.
 */
function NavigationShortcuts() {
	const router = useRouter();
	const navigate = useNavigate();
	const actions = useActions();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	useCommandHandler("app.openDiagnostics", "base", () => {
		void navigate({ to: "/diagnostics" });
		return true;
	});
	useCommandHandler("app.closeDiagnostics", "base", () => {
		if (pathname !== "/diagnostics") return false;
		void navigate({ to: "/" });
		return true;
	});
	useCommandHandler("nav.back", "base", () => {
		router.history.back();
		return true;
	});
	useCommandHandler("nav.forward", "base", () => {
		router.history.forward();
		return true;
	});
	useCommandHandler("workspace.createFromSource", "base", () => {
		void navigate({ to: "/create" });
		return true;
	});
	useCommandHandler("app.openSettings", "base", () => {
		void navigate({ to: "/settings/user/$page", params: { page: "general" } });
		return true;
	});
	useCommandHandler("app.quit", "base", () => {
		void actions.app.quit();
		return true;
	});
	return null;
}

/** The one workspace route a path names, or null for every other route. */
function workspaceIdFromPath(pathname: string): string | null {
	const match = /^\/repository\/[^/]+\/workspace\/([^/]+)\/?$/.exec(pathname);
	if (match?.[1] === undefined) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
}

/**
 * Saves the workspace route once it settles, so "/" can reopen it on the next launch. Only workspace routes
 * are saved: every other route leaves the last one in place.
 */
function RouteLocationPersistence() {
	const location = useRouterState({ select: (state) => state.location });
	useEffect(() => {
		const workspaceId = workspaceIdFromPath(location.pathname);
		if (workspaceId === null) return;
		const search = zWorkspaceSearch.safeParse(location.search);
		if (!search.success) return;
		saveSavedLocation({ workspaceId, search: search.data });
	}, [location]);
	return null;
}

/**
 * Restores the last workspace route when the app opens at "/". With nothing saved the centre empty state
 * stays. A saved workspace that is gone or archived falls back to the most recently used ready one.
 */
function RestoreLastLocation() {
	const { services } = useServices();
	const navigate = useNavigate();
	const reposLoaded = useStore(services.repo.store, (state) => state.loaded);
	const hasProjects = useStore(
		services.repo.store,
		(state) => Object.keys(state.reposById).length > 0,
	);
	const workspacesLoaded = useStore(services.workspace.store, (state) => state.loaded);
	const workspacesById = useStore(services.workspace.store, (state) => state.workspacesById);
	const [saved] = useState(() => readSavedLocation());
	const restored = useRef(false);

	useEffect(() => {
		if (restored.current || saved === null) return;
		if (!reposLoaded || !workspacesLoaded) return;
		const target = chooseRestoreTarget({
			saved,
			workspaces: Object.values(workspacesById),
			hasProjects,
		});
		if (target.kind !== "workspace") return;
		restored.current = true;
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: target.repoId, workspaceId: target.workspaceId },
			search: target.search ?? {},
			replace: true,
		});
	}, [hasProjects, navigate, reposLoaded, saved, workspacesById, workspacesLoaded]);

	return <NoWorkspaceSelected />;
}

function RootLayout() {
	const onDeepLink = useDeepLinkOpener();
	return (
		<CommandDispatcher onDeepLink={onDeepLink}>
			<AppearanceController />
			<NavigationShortcuts />
			<NextUnreadController />
			<RouteLocationPersistence />
			<Outlet />
			<GlobalOverlays />
			<FileDropTarget />
		</CommandDispatcher>
	);
}

/**
 * Sends the route Home when the chat in the URL was deleted. The store is loaded before the router's first
 * repair, so a missing chat is reported only after the list is known.
 */
function SessionRouteRepair({
	workspaceId,
	sessionId,
}: {
	workspaceId: string;
	sessionId: string;
}) {
	const { services } = useServices();
	const navigate = useNavigate();
	const state = useStore(services.sessions.store, (value) => value);

	useEffect(() => {
		if (!state.loaded) return;
		const session = state.sessions[sessionId];
		if (session === undefined || session.workspaceId !== workspaceId) {
			void navigate({ to: "/all-workspaces", replace: true });
		}
	}, [navigate, sessionId, state, workspaceId]);

	return null;
}

const rootRoute = createRootRoute({
	component: RootLayout,
	notFoundComponent: NotFoundScreen,
	errorComponent: ({ error, reset }) => (
		<RouteErrorScreen
			error={error instanceof Error ? error : new Error(String(error))}
			reset={reset}
		/>
	),
});

// ---- routes with the sidebar

const mainLayoutRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: "main-layout",
	component: AppShell,
});

const indexRoute = createRoute({
	getParentRoute: () => mainLayoutRoute,
	path: "/",
	component: RestoreLastLocation,
});

const workspaceRoute = createRoute({
	getParentRoute: () => mainLayoutRoute,
	path: "/repository/$repositoryId/workspace/$workspaceId",
	validateSearch: zWorkspaceSearch,
	component: function WorkspaceRoute() {
		const { repositoryId, workspaceId } = workspaceRoute.useParams();
		const search = workspaceRoute.useSearch();
		const navigate = workspaceRoute.useNavigate();
		const { services, actions } = useServices();
		const workspaceState = useStore(services.workspace.store, (state) => state);
		const workspace = workspaceState.workspacesById[workspaceId];
		const sawWorkspace = useRef(false);

		// Route repair: a workspace that is gone or being archived belongs on Home, not on a dead screen.
		useEffect(() => {
			if (!workspaceState.loaded) return;
			if (workspace === undefined) {
				// An empty list is the first frame of a fresh app, not proof that this id was deleted.
				if (sawWorkspace.current || Object.keys(workspaceState.workspacesById).length > 0) {
					void navigate({ to: "/all-workspaces", replace: true });
				}
				return;
			}
			sawWorkspace.current = true;
			if (!canShowWorkspaceRoute(workspace)) {
				void navigate({ to: "/all-workspaces", replace: true });
			}
		}, [navigate, workspace, workspaceState.loaded, workspaceState.workspacesById]);

		// With no search set, reopen the chat tab this workspace had open last.
		useEffect(() => {
			if (!workspaceState.loaded || workspace === undefined) return;
			if (!canShowWorkspaceRoute(workspace)) return;
			if (search.tab !== undefined || workspace.activeSessionId === null) return;
			const sessionId = workspace.activeSessionId;
			void navigate({
				search: (previous) => ({ ...previous, tab: "session", sessionId }),
				replace: true,
			});
		}, [navigate, search.tab, workspace, workspaceState.loaded]);

		// Keep the stored chat tab current as the user moves between tabs.
		useEffect(() => {
			if (search.tab !== "session" || search.sessionId === undefined) return;
			if (workspace === undefined || workspace.activeSessionId === search.sessionId) return;
			const state = services.sessions.store.getState();
			if (state.loaded) {
				const session = state.sessions[search.sessionId];
				if (session === undefined || session.workspaceId !== workspaceId) return;
			}
			void actions.workspaces.setActiveSession(
				workspaceId as WorkspaceId,
				search.sessionId as SessionId,
			);
		}, [actions, search.sessionId, search.tab, services, workspace, workspaceId]);

		const onSearchChange = (patch: Partial<WorkspaceSearch>) =>
			navigate({ search: (previous) => ({ ...previous, ...patch }) });
		return (
			<>
				<NotBuiltYet area="Workspace" resetKey={workspaceId}>
					<WorkspaceScreen
						repoId={repositoryId as RepoId}
						workspaceId={workspaceId as WorkspaceId}
						search={search}
						onSearchChange={onSearchChange}
					/>
				</NotBuiltYet>
				{search.tab === "session" && search.sessionId !== undefined ? (
					<SessionRouteRepair workspaceId={workspaceId} sessionId={search.sessionId} />
				) : null}
			</>
		);
	},
});

const homeRoute = createRoute({
	getParentRoute: () => mainLayoutRoute,
	path: "/all-workspaces",
	component: () => (
		<NotBuiltYet area="Home">
			<HomeScreen />
		</NotBuiltYet>
	),
});

const dashboardRoute = createRoute({
	getParentRoute: () => mainLayoutRoute,
	path: "/dashboard",
	component: () => (
		<NotBuiltYet area="Dashboard">
			<DashboardScreen />
		</NotBuiltYet>
	),
});

/** /backlog lists workspaces saved to start later (WS-11). */
const backlogRoute = createRoute({
	getParentRoute: () => mainLayoutRoute,
	path: "/backlog",
	component: () => (
		<NotBuiltYet area="Backlog">
			<BacklogScreen />
		</NotBuiltYet>
	),
});

/** /create opens with a project, branch, first message, section or backlog workspace already chosen. */
const zCreateWorkspaceSearch = z.object({
	repo: z.string().optional().catch(undefined),
	section: z.string().optional().catch(undefined),
	backlog: z.string().optional().catch(undefined),
	branch: z.string().optional().catch(undefined),
	prompt: z.string().optional().catch(undefined),
});

const createWorkspaceRoute = createRoute({
	getParentRoute: () => mainLayoutRoute,
	path: "/create",
	validateSearch: zCreateWorkspaceSearch,
	component: () => (
		<NotBuiltYet area="New workspace">
			<CreateWorkspacePage />
		</NotBuiltYet>
	),
});

// ---- routes without the sidebar

const settingsIndexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	beforeLoad: () => {
		throw redirect({ to: "/settings/user/$page", params: { page: "general" } });
	},
});

const userSettingsIndexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/user",
	beforeLoad: () => {
		throw redirect({ to: "/settings/user/$page", params: { page: "general" } });
	},
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/user/$page",
	component: function SettingsRoute() {
		const { page } = settingsRoute.useParams();
		// Settings draws its own title bar row (Back and its top bar), so no FullPage strip.
		return (
			<NotBuiltYet area="Settings" resetKey={page}>
				<SettingsScreen page={page} />
			</NotBuiltYet>
		);
	},
});

const repoSettingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/repos/$repoId/$page",
	component: function RepoSettingsRoute() {
		const { repoId, page } = repoSettingsRoute.useParams();
		return (
			<NotBuiltYet area="Settings" resetKey={`${repoId}:${page}`}>
				<SettingsScreen page={`repo:${repoId}:${page}`} />
			</NotBuiltYet>
		);
	},
});

const diagnosticsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/diagnostics",
	component: () => (
		<FullPage>
			<NotBuiltYet area="Diagnostics">
				<DiagnosticsScreen />
			</NotBuiltYet>
		</FullPage>
	),
});

const onboardingRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/first-run-onboarding",
	component: () => (
		<FullPage>
			<NotBuiltYet area="Welcome">
				<OnboardingScreen />
			</NotBuiltYet>
		</FullPage>
	),
});

const routeTree = rootRoute.addChildren([
	mainLayoutRoute.addChildren([
		indexRoute,
		workspaceRoute,
		homeRoute,
		dashboardRoute,
		backlogRoute,
		createWorkspaceRoute,
	]),
	settingsIndexRoute,
	userSettingsIndexRoute,
	settingsRoute,
	repoSettingsRoute,
	diagnosticsRoute,
	onboardingRoute,
]);

/** The history is passed in: the app uses the browser's, tests use a memory history. */
export function createAppRouter(history?: RouterHistory) {
	return createRouter({ routeTree, ...(history ? { history } : {}) });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
	interface Register {
		router: AppRouter;
	}
}

export function AppRoutes({ router }: { router: AppRouter }) {
	return <RouterProvider router={router} />;
}
