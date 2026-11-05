import type { RepoId, WorkspaceId } from "@conducted/shared";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repo, Workspace } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";

const settings = vi.hoisted(() => ({
	group: "repo",
	sort: "updated",
	filter: "",
	set: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useSetting: (key: string) => {
		if (key === "sidebar_group_by") return settings.group;
		if (key === "sidebar_sort_by") return settings.sort;
		if (key === "manual_workspace_order") return false;
		return settings.filter;
	},
	useActions: () => ({ settings: { set: settings.set } }),
}));

vi.mock("./WorkspaceRow.tsx", () => ({
	WorkspaceRow: ({ workspace }: { workspace: Workspace }) => (
		<div data-testid="workspace-row">{workspace.displayName}</div>
	),
}));

vi.mock("./ViewOptionsMenu.tsx", () => ({
	ViewOptionsMenu: () => <button type="button">View options</button>,
}));

const { GroupedWorkspaces } = await import("./GroupedWorkspaces.tsx");

afterEach(cleanup);

function repo(id: string): Repo {
	return {
		id: id as RepoId,
		name: id,
		rootPath: `/repos/${id}`,
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
		displayOrder: id === "app" ? 0 : 1,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
	};
}

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: id as WorkspaceId,
		repoId: "app" as RepoId,
		directoryName: id,
		path: `/workspaces/${id}`,
		branch: `branch-${id}`,
		branchIsPlaceholder: false,
		displayName: id,
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
		lastActivityAt: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

describe("NAV-03 GroupedWorkspaces", () => {
	it("groups by project and shows a pinned workspace only in Pinned", async () => {
		settings.group = "repo";
		renderWithRouter(
			<GroupedWorkspaces
				repos={[repo("app"), repo("api")]}
				workspaces={[
					workspace("one", { pinnedAt: 1 }),
					workspace("two"),
					workspace("three", { repoId: "api" as RepoId }),
				]}
			/>,
		);
		expect(await screen.findByRole("region", { name: "Pinned" })).toBeTruthy();
		const pinned = screen.getByRole("region", { name: "Pinned" });
		expect(within(pinned).getAllByTestId("workspace-row")).toHaveLength(1);
		expect(within(pinned).getByText("one")).toBeTruthy();
		const app = screen.getByRole("region", { name: "app" });
		expect(within(app).getByText("two")).toBeTruthy();
		expect(within(app).queryByText("one")).toBeNull();
		expect(screen.getByRole("region", { name: "api" })).toBeTruthy();
	});

	it("groups by status when that setting is chosen", async () => {
		settings.group = "status";
		renderWithRouter(
			<GroupedWorkspaces
				repos={[repo("app")]}
				workspaces={[
					workspace("done", { kanbanStatus: "done" }),
					workspace("progress", { kanbanStatus: "in_progress" }),
				]}
			/>,
		);
		expect(await screen.findByRole("region", { name: "Done" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "In progress" })).toBeTruthy();
	});

	it("shows the empty note when no project matches the filter", async () => {
		settings.group = "repo";
		settings.filter = "api";
		renderWithRouter(
			<GroupedWorkspaces repos={[repo("app"), repo("api")]} workspaces={[workspace("one")]} />,
		);
		expect(await screen.findByText("No matching workspaces")).toBeTruthy();
		settings.filter = "";
	});
});
