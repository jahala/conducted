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
 * /settings/user/general). `$page` is a single segment, so repository pages need an encoding or a splat route
 * from the settings owner. The workspace param is `$workspaceId`, not `$localWorkspaceId`, because there are no
 * cloud workspaces.
 * Must handle: an unknown address (NotFoundScreen); a screen that throws (RouteErrorScreen with retry); a
 * changed workspace id resets a failed screen (resetKey); invalid search values are dropped (see
 * workspace-search.ts); navigation never reloads the page.
 * Test first: navigating to /all-workspaces renders the Home screen area; "/" renders the centre empty state.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	type RouterHistory,
	RouterProvider,
	redirect,
} from "@tanstack/react-router";
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
		const onSearchChange = (patch: Partial<WorkspaceSearch>) =>
			navigate({ search: (previous) => ({ ...previous, ...patch }) });
		return (
			<NotBuiltYet area="Workspace" resetKey={workspaceId}>
				<WorkspaceScreen
					repoId={repositoryId as RepoId}
					workspaceId={workspaceId as WorkspaceId}
					search={search}
					onSearchChange={onSearchChange}
				/>
			</NotBuiltYet>
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
