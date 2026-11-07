import type { RepoId, WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Repo, Session, Workspace, WorkspaceStatus } from "../../core/model.ts";

const hooks = vi.hoisted(() => ({
	status: null as WorkspaceStatus | null,
	sessions: { state: "ready", data: [] } as Loadable<Session[]>,
	markRead: vi.fn(),
	markUnread: vi.fn(),
	git: { state: "loading" } as Loadable<{ linesAdded: number; linesRemoved: number }>,
}));

vi.mock("../composer/draft-sources.ts", () => ({
	useWorkspaceDraft: () => null,
}));

vi.mock("../../core/hooks.ts", () => ({
	useWorkspaceStatus: () => hooks.status,
	useSetting: () => "",
	useGitHubAccess: () => ({ state: "loading" }),
	useSessions: () => hooks.sessions,
	useGitState: () => hooks.git,
	useLiveShortcut: (commandId: string) => (commandId === "workspace.switch2" ? "⌃2" : null),
	useActions: () => ({
		workspaces: { markRead: hooks.markRead, markUnread: hooks.markUnread },
	}),
}));

const { WorkspaceRow, relativeTime, compactCount } = await import("./WorkspaceRow.tsx");

afterEach(cleanup);

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
		host: { kind: "local" },
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
			/>,
		);
		expect(await screen.findByText("Fix the login flow")).toBeTruthy();
	});

	it("shows the unread dot when a chat has something unread", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [{ unreadCount: 2 } as Session] };
		renderRow(
			<WorkspaceRow workspace={workspace()} repo={repo()} selected={false} shortcutIndex={null} />,
		);
		expect(await screen.findByRole("img", { name: "Unread" })).toBeTruthy();
	});

	// Conductor's row is one line: the status words sit on the status icon, not on a second line
	// (renderApp @10437578). This test asserted the old subtitle and now asserts the icon's name.
	it("names the status on its icon, with no second line, and marks the selected row", async () => {
		hooks.status = { kind: "agent", label: "needs_permission" };
		hooks.sessions = { state: "ready", data: [] };
		renderRow(<WorkspaceRow workspace={workspace()} repo={repo()} selected shortcutIndex={1} />);
		const icon = await screen.findByRole("img", { name: "Need permission" });
		expect(icon.getAttribute("title")).toBe("Need permission");
		expect(screen.queryByText("Need permission")).toBeNull();
		const link = screen.getByRole("link");
		expect(link.getAttribute("aria-current")).toBe("page");
		// Conductor marks the selected row by its fill only; the name keeps weight 450 (@10427352).
		const name = within(link).getByText("Fix login");
		expect(name.className).toContain("font-book");
		expect(name.className).not.toContain("font-medium");
	});

	it("shows the live shortcut hint from the binding, not a hard-coded one", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [] };
		renderRow(
			<WorkspaceRow workspace={workspace()} repo={repo()} selected={false} shortcutIndex={2} />,
		);
		expect(await screen.findByText("⌃2")).toBeTruthy();
		expect(screen.queryByText("⌘2")).toBeNull();
	});
});

describe("NAV-03 row padding", () => {
	it("pads the row by where it sits: 20px in the groups, 12px in Pinned, 6px in sections", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [] };
		const padding = { grouped: "pl-5", pinned: "pl-3", flush: "pl-1.5" } as const;
		for (const [indent, expected] of Object.entries(padding) as [keyof typeof padding, string][]) {
			const view = renderRow(
				<WorkspaceRow
					workspace={workspace()}
					repo={repo()}
					selected={false}
					shortcutIndex={null}
					indent={indent}
				/>,
			);
			const link = await screen.findByRole("link");
			expect(link.className.split(" ")).toContain(expected);
			view.unmount();
		}
	});
});

describe("NAV-03 row status", () => {
	// Was "prints the status text": the words moved from a second line to the icon's name (see above).
	it("names the working status on its icon and leaves the spinner out of the live regions", async () => {
		hooks.status = { kind: "agent", label: "working" };
		hooks.sessions = { state: "ready", data: [] };
		renderRow(
			<WorkspaceRow workspace={workspace()} repo={repo()} selected={false} shortcutIndex={null} />,
		);
		expect(await screen.findByRole("img", { name: "Working…" })).toBeTruthy();
		expect(screen.queryByText("Working…")).toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
	});
});

describe("NAV-03 row time", () => {
	// This test asserted "5m" on a row with no line counts. Conductor's row shows no time (D098).
	it("shows no time on a row without line counts", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [] };
		renderRow(
			<WorkspaceRow workspace={workspace()} repo={repo()} selected={false} shortcutIndex={null} />,
		);
		expect((await screen.findByRole("link")).querySelector("time")).toBeNull();
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

describe("NAV-03 row line counts", () => {
	afterEach(() => {
		hooks.git = { state: "loading" };
	});

	it("writes counts as Conductor does: 552, 4.1k, 16k", () => {
		expect(compactCount(552)).toBe("552");
		expect(compactCount(4_100)).toBe("4.1k");
		expect(compactCount(1_000)).toBe("1k");
		expect(compactCount(16_400)).toBe("16k");
	});

	it("shows the workspace's added and removed lines in place of the time", async () => {
		hooks.status = null;
		hooks.sessions = { state: "ready", data: [] };
		hooks.git = { state: "ready", data: { linesAdded: 4_100, linesRemoved: 3 } };
		renderRow(
			<WorkspaceRow workspace={workspace()} repo={repo()} selected={false} shortcutIndex={null} />,
		);
		expect(await screen.findByText("+4.1k")).toBeTruthy();
		expect(screen.getByText("-3")).toBeTruthy();
		expect(document.querySelector("time")).toBeNull();
	});
});
