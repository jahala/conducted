import type { RepoId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Repo, Workspace } from "../../core/model.ts";
import {
	buildSidebarGroups,
	orderedWorkspaceIds,
	readGroupBySetting,
	type SidebarView,
	writeGroupBySetting,
} from "./sidebar-view.ts";

function repo(id: string, overrides: Partial<Repo> = {}): Repo {
	return {
		id: id as RepoId,
		name: id,
		rootPath: `/repos/${id}`,
		remoteUrl: null,
		defaultBranch: "main",
		icon: null,
		displayOrder: 0,
		hidden: false,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
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
		lastActivityAt: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

const view = (overrides: Partial<SidebarView> = {}): SidebarView => ({
	groupBy: "status",
	sortBy: "updated",
	manualOrder: false,
	projectFilter: [],
	...overrides,
});

const input = (props: {
	repos?: Repo[];
	workspaces?: Workspace[];
	view?: Partial<SidebarView>;
	sections?: never[];
	manualOrder?: Map<string, WorkspaceId[]>;
}) => ({
	repos: props.repos ?? [repo("app")],
	workspaces: props.workspaces ?? [],
	sections: props.sections ?? [],
	view: view(props.view),
	manualOrder: props.manualOrder ?? new Map<string, WorkspaceId[]>(),
});

describe("NAV-03 buildSidebarGroups", () => {
	it("puts Pinned first, then status groups in the fixed order, each newest activity first", () => {
		const groups = buildSidebarGroups(
			input({
				workspaces: [
					workspace("pinned", { pinnedAt: 1, lastActivityAt: 10 }),
					workspace("backlog", { kanbanStatus: "backlog", lastActivityAt: 90 }),
					workspace("progress-old", { kanbanStatus: "in_progress", lastActivityAt: 20 }),
					workspace("progress-new", { kanbanStatus: "in_progress", lastActivityAt: 50 }),
					workspace("done", { kanbanStatus: "done", lastActivityAt: 70 }),
				],
			}),
		);
		expect(groups.map((group) => group.label)).toEqual([
			"Pinned",
			"Done",
			"In progress",
			"Backlog",
		]);
		expect(groups[0]?.workspaceIds).toEqual(["pinned"]);
		expect(groups[2]?.workspaceIds).toEqual(["progress-new", "progress-old"]);
	});

	it("groups by project and keeps a pinned workspace out of its project group", () => {
		const groups = buildSidebarGroups(
			input({
				repos: [repo("app", { displayOrder: 0 }), repo("api", { displayOrder: 1 })],
				workspaces: [
					workspace("one", { repoId: "app" as RepoId, pinnedAt: 5 }),
					workspace("two", { repoId: "app" as RepoId }),
					workspace("three", { repoId: "api" as RepoId }),
				],
				view: { groupBy: "project" },
			}),
		);
		expect(groups.map((group) => group.label)).toEqual(["Pinned", "app", "api"]);
		expect(groups[0]?.workspaceIds).toEqual(["one"]);
		expect(groups[1]?.workspaceIds).toEqual(["two"]);
		expect(groups[2]?.workspaceIds).toEqual(["three"]);
	});

	it("leaves out archived workspaces and workspaces of hidden projects", () => {
		const groups = buildSidebarGroups(
			input({
				repos: [repo("app"), repo("hidden", { hidden: true })],
				workspaces: [
					workspace("visible"),
					workspace("archived", { state: "archived", archivedAt: 1 }),
					workspace("hidden-repo", { repoId: "hidden" as RepoId }),
				],
			}),
		);
		expect(groups.flatMap((group) => group.workspaceIds)).toEqual(["visible"]);
	});

	it("shows only the filtered projects", () => {
		const groups = buildSidebarGroups(
			input({
				repos: [repo("app"), repo("api")],
				workspaces: [
					workspace("one", { repoId: "app" as RepoId }),
					workspace("two", { repoId: "api" as RepoId }),
				],
				view: { groupBy: "project", projectFilter: ["api" as RepoId] },
			}),
		);
		expect(groups.map((group) => group.label)).toEqual(["api"]);
		expect(groups[0]?.workspaceIds).toEqual(["two"]);
	});

	it("uses the user's manual order for a group when it is on", () => {
		const groups = buildSidebarGroups(
			input({
				workspaces: [workspace("one"), workspace("two"), workspace("three")],
				view: { manualOrder: true },
				manualOrder: new Map([["status:in_progress", ["three", "one"] as WorkspaceId[]]]),
			}),
		);
		expect(groups[0]?.workspaceIds).toEqual(["three", "one", "two"]);
	});

	it("sorts by creation time when that is chosen", () => {
		const groups = buildSidebarGroups(
			input({
				workspaces: [
					workspace("older", { createdAt: 10, lastActivityAt: 90 }),
					workspace("newer", { createdAt: 20, lastActivityAt: 10 }),
				],
				view: { sortBy: "created" },
			}),
		);
		expect(groups[0]?.workspaceIds).toEqual(["newer", "older"]);
	});

	it("keeps 300 workspaces in one stable group order", () => {
		const workspaces = Array.from({ length: 300 }, (_, index) =>
			workspace(`w${index}`, { lastActivityAt: index }),
		);
		const groups = buildSidebarGroups(input({ workspaces }));
		const ids = orderedWorkspaceIds(groups);
		expect(ids).toHaveLength(300);
		expect(new Set(ids).size).toBe(300);
		expect(ids[0]).toBe("w299");
		expect(ids[299]).toBe("w0");
	});
});

describe("NAV-03 sidebar view setting", () => {
	it("maps the saved group value to the view and back through one table", () => {
		expect(readGroupBySetting("repo")).toBe("project");
		expect(readGroupBySetting("status")).toBe("status");
		expect(readGroupBySetting("section")).toBe("section");
		expect(writeGroupBySetting("project")).toBe("repo");
		expect(writeGroupBySetting("status")).toBe("status");
	});

	it("puts the visible rows in the order Cmd+1..9 and previous/next follow", () => {
		const groups = buildSidebarGroups(
			input({
				repos: [repo("app", { displayOrder: 0 }), repo("api", { displayOrder: 1 })],
				workspaces: [
					workspace("pinned", { pinnedAt: 1, lastActivityAt: 5 }),
					workspace("one", { repoId: "app" as RepoId, lastActivityAt: 20 }),
					workspace("two", { repoId: "app" as RepoId, lastActivityAt: 30 }),
					workspace("three", { repoId: "api" as RepoId, lastActivityAt: 10 }),
				],
				view: { groupBy: "project" },
			}),
		);
		expect(orderedWorkspaceIds(groups)).toEqual(["pinned", "two", "one", "three"]);
	});
});
