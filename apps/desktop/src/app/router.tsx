/**
 * @feature NAV-02 Routes
 * Owns: the route tree and the thin adapters that turn URL params into screen props.
 * Behaviour: ui-map.md 2 (route table), structure-map.md 3.2 (routes). Local routes only: the cloud routes
 * (login, routines, pull-requests, profile, org onboarding) are out of scope.
 * Routes:
 *   (main layout, with sidebar)  /                                                       centre empty state
 *                                /repository/$repositoryId/workspace/$workspaceId   workspace, tab state in search
 *                                /all-workspaces                                       Home
 *                                /dashboard                                            Kanban board
 *                                /create                                               new workspace page
 *   (no sidebar)                 /settings, /settings/$page, /diagnostics, /first-run-onboarding
 * Our design choices: `/settings` redirects to `/settings/general` (Conductor redirects /settings/user to
 * /settings/user/general). Repository pages have their own route, `/settings/repos/$repoId/$page`, and pass
 * the page to the settings screen as `repo:<repoId>:<page>`. The workspace param is `$workspaceId`, not
 * `$localWorkspaceId`, because there are no cloud workspaces.
 * Must handle: an unknown address (NotFoundScreen); a screen that throws (RouteErrorScreen with retry); a
 * changed workspace id resets a failed screen (resetKey); invalid search values are dropped (see
 * workspace-search.ts); navigation never reloads the page; a workspace or chat that was deleted or archived
 * sends the route Home instead of drawing a dead screen; a bare workspace address reopens that workspace's
 * stored chat tab.
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
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { useServices } from "../core/context.tsx";
import { DashboardScreen } from "../features/dashboard/DashboardScreen.tsx";
import { DiagnosticsScreen } from "../features/diagnostics/DiagnosticsScreen.tsx";
import { HomeScreen } from "../features/home/HomeScreen.tsx";
import { OnboardingScreen } from "../features/onboarding/OnboardingScreen.tsx";
import { SettingsScreen } from "../features/settings/SettingsScreen.tsx";
import { WorkspaceScreen } from "../features/workspace/WorkspaceScreen.tsx";
import { type WorkspaceSearch, zWorkspaceSearch } from "../features/workspace/workspace-search.ts";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";
import { AppShell } from "./AppShell.tsx";
import { CreateWorkspacePage } from "./CreateWorkspacePage.tsx";
import { FullPage } from "./FullPage.tsx";
import { GlobalOverlays } from "./GlobalOverlays.tsx";
import { NoWorkspaceSelected } from "./NoWorkspaceSelected.tsx";
import { NotFoundScreen, RouteErrorScreen } from "./route-states.tsx";

function RootLayout() {
	return (
		<>
			<Outlet />
			<GlobalOverlays />
		</>
	);
}

/** The parts of the sessions store the route needs, so the check does not depend on the whole service. */
interface SessionVisibilityState {
	loaded: boolean;
	sessions: Readonly<Record<string, { workspaceId: string }>>;
}

/**
 * Sends the route Home when the chat in the URL was deleted. It runs only when the sessions service exists,
 * so a fixture without one keeps its workspace route. The store is loaded before the router's first repair.
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
	const sessions = services.sessions as unknown as { store: StoreApi<SessionVisibilityState> };
	const state = useStore(sessions.store, (value) => value);

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
	component: NoWorkspaceSelected,
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
		const hasSessions = (services as { sessions?: unknown }).sessions !== undefined;
		const workspace = workspaceState.workspacesById[workspaceId];
		const sawWorkspace = useRef(false);

		// Route repair: a workspace that is gone or archived belongs on Home, not on a dead screen.
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
			if (workspace.state === "archived" || workspace.state === "archiving") {
				void navigate({ to: "/all-workspaces", replace: true });
			}
		}, [navigate, workspace, workspaceState.loaded, workspaceState.workspacesById]);

		// With no search set, reopen the chat tab this workspace had open last.
		useEffect(() => {
			if (!workspaceState.loaded || workspace === undefined) return;
			if (workspace.state === "archived" || workspace.state === "archiving") return;
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
			if (hasSessions) {
				const sessions = (services as { sessions: { store: StoreApi<SessionVisibilityState> } })
					.sessions;
				const state = sessions.store.getState();
				if (state.loaded) {
					const session = state.sessions[search.sessionId];
					if (session === undefined || session.workspaceId !== workspaceId) return;
				}
			}
			void actions.workspaces?.setActiveSession?.(
				workspaceId as WorkspaceId,
				search.sessionId as SessionId,
			);
		}, [actions, hasSessions, search.sessionId, search.tab, services, workspace, workspaceId]);

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
				{hasSessions && search.tab === "session" && search.sessionId !== undefined ? (
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

const createWorkspaceRoute = createRoute({
	getParentRoute: () => mainLayoutRoute,
	path: "/create",
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
		throw redirect({ to: "/settings/$page", params: { page: "general" } });
	},
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/$page",
	component: function SettingsRoute() {
		const { page } = settingsRoute.useParams();
		return (
			<FullPage>
				<NotBuiltYet area="Settings" resetKey={page}>
					<SettingsScreen page={page} />
				</NotBuiltYet>
			</FullPage>
		);
	},
});

const repoSettingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/repos/$repoId/$page",
	component: function RepoSettingsRoute() {
		const { repoId, page } = repoSettingsRoute.useParams();
		return (
			<FullPage>
				<NotBuiltYet area="Settings" resetKey={`${repoId}:${page}`}>
					<SettingsScreen page={`repo:${repoId}:${page}`} />
				</NotBuiltYet>
			</FullPage>
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
		createWorkspaceRoute,
	]),
	settingsIndexRoute,
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
