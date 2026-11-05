import type { RepoId, WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Repo, Session, Workspace, WorkspaceStatus } from "../../core/model.ts";

const hooks = vi.hoisted(() => ({
	status: null as WorkspaceStatus | null,
	sessions: { state: "ready", data: [] } as Loadable<Session[]>,
	markRead: vi.fn(),
	markUnread: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useWorkspaceStatus: () => hooks.status,
	useSessions: () => hooks.sessions,
	useLiveShortcut: (commandId: string) => (commandId === "workspace.switch2" ? "⌃2" : null),
	useActions: () => ({
		workspaces: { markRead: hooks.markRead, markUnread: hooks.markUnread },
	}),
}));

const { WorkspaceRow, relativeTime } = await import("./WorkspaceRow.tsx");

afterEach(cleanup);

// The workspace helper below was last active at 1_000.
const NOW = 1_000;

function repo(): Repo {
	return {
		id: "app" as RepoId,
		name: "app",
		rootPath: "/repos/app",
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
		displayOrder: 0,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
	};
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "one" as WorkspaceId,
		repoId: "app" as RepoId,
		directoryName: "quiet-meadow",
		path: "/workspaces/one",
		branch: "fix-login",
		branchIsPlaceholder: false,
		displayName: null,
		targetBranch: "main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 0,
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
		lastActivityAt: 1_000,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function renderRow(children: ReactNode) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{children}</>,
	});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <p>workspace</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, workspaceRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return render(<RouterProvider router={router} />);
}

describe("NAV-03 WorkspaceRow", () => {
	it("shows the PR title when the user has not named the workspace", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [] };
		renderRow(
			<WorkspaceRow
				workspace={workspace({ prTitle: "Fix the login flow" })}
				repo={repo()}
				selected={false}
				shortcutIndex={null}
				now={NOW}
			/>,
		);
		expect(await screen.findByText("Fix the login flow")).toBeTruthy();
	});

	it("shows the unread dot when a chat has something unread", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [{ unreadCount: 2 } as Session] };
		renderRow(
			<WorkspaceRow
				workspace={workspace()}
				repo={repo()}
				selected={false}
				shortcutIndex={null}
				now={NOW}
			/>,
		);
		expect(await screen.findByRole("img", { name: "Unread" })).toBeTruthy();
	});

	it("shows the status subtitle and marks the selected row", async () => {
		hooks.status = { kind: "agent", label: "needs_permission" };
		hooks.sessions = { state: "ready", data: [] };
		renderRow(
			<WorkspaceRow workspace={workspace()} repo={repo()} selected shortcutIndex={1} now={NOW} />,
		);
		expect(await screen.findByText("Need permission")).toBeTruthy();
		const link = screen.getByRole("link");
		expect(link.getAttribute("aria-current")).toBe("page");
	});

	it("shows the live shortcut hint from the binding, not a hard-coded one", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [] };
		renderRow(
			<WorkspaceRow
				workspace={workspace()}
				repo={repo()}
				selected={false}
				shortcutIndex={2}
				now={NOW}
			/>,
		);
		expect(await screen.findByText("⌃2")).toBeTruthy();
		expect(screen.queryByText("⌘2")).toBeNull();
	});
});

describe("NAV-03 row status", () => {
	it("prints the status text and leaves the spinner out of the live regions", async () => {
		hooks.status = { kind: "agent", label: "working" };
		hooks.sessions = { state: "ready", data: [] };
		renderRow(
			<WorkspaceRow
				workspace={workspace()}
				repo={repo()}
				selected={false}
				shortcutIndex={null}
				now={NOW}
			/>,
		);
		expect(await screen.findByText("Working…")).toBeTruthy();
		expect(screen.queryByRole("status")).toBeNull();
	});
});

describe("NAV-03 row time", () => {
	it("shows how long ago from the time the list gives it", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [] };
		renderRow(
			<WorkspaceRow
				workspace={workspace()}
				repo={repo()}
				selected={false}
				shortcutIndex={null}
				now={1_000 + 5 * 60_000}
			/>,
		);
		expect((await screen.findByRole("link")).querySelector("time")?.textContent).toBe("5m");
	});
});

describe("NAV-03 row helpers", () => {
	it("gives a short relative time", () => {
		const now = 1_000_000;
		expect(relativeTime(now - 5_000, now)).toBe("now");
		expect(relativeTime(now - 5 * 60_000, now)).toBe("5m");
		expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe("3h");
		expect(relativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe("3d");
	});
});
