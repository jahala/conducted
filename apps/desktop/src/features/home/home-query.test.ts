import type { RepoId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Repo, Workspace } from "../../core/model.ts";
import { HOME_PAGE_SIZE, type HomeFilterState, queryHome } from "./home-query.ts";

const FILTERS: HomeFilterState = {
	search: "",
	projects: [],
	archivedOnly: false,
	sortBy: "updated",
};

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
		branch: `jahala/${id}`,
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

describe("NAV-05 home-query", () => {
	it("finds a workspace by branch ignoring case", () => {
		const page = queryHome({
			workspaces: [
				workspace("one", { branch: "fix-auth-bug" }),
				workspace("two", { branch: "update-docs" }),
			],
			repos: [repo("app")],
			filters: { ...FILTERS, search: "AUTH" },
			pageCount: 1,
		});
		expect(page.items.map((row) => row.id)).toEqual(["one"]);
	});

	it("ignores accents in the search", () => {
		const page = queryHome({
			workspaces: [workspace("one", { displayName: "Café repairs" })],
			repos: [repo("app")],
			filters: { ...FILTERS, search: "cafe" },
			pageCount: 1,
		});
		expect(page.items).toHaveLength(1);
	});

	it("matches the repository name as well as the workspace fields", () => {
		const page = queryHome({
			workspaces: [
				workspace("one", { repoId: "api" as RepoId, displayName: "one" }),
				workspace("two", { repoId: "app" as RepoId, displayName: "two" }),
			],
			repos: [repo("app"), repo("api-service")],
			filters: { ...FILTERS, search: "api" },
			pageCount: 1,
		});
		expect(page.items.map((row) => row.id)).toEqual(["one"]);
	});

	it("pages by 50 and reports the rest", () => {
		const workspaces = Array.from({ length: 60 }, (_, index) =>
			workspace(`w${String(index).padStart(2, "0")}`),
		);
		const first = queryHome({
			workspaces,
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 1,
		});
		expect(first.items).toHaveLength(HOME_PAGE_SIZE);
		expect(first.total).toBe(60);
		expect(first.hasMore).toBe(true);

		const second = queryHome({
			workspaces,
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 2,
		});
		expect(second.items).toHaveLength(10);
		expect(second.hasMore).toBe(false);
	});

	it("gives an empty list for a page past the end", () => {
		const page = queryHome({
			workspaces: [workspace("one")],
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 9,
		});
		expect(page.items).toEqual([]);
		expect(page.hasMore).toBe(false);
	});

	it("hides archived workspaces unless the archived filter is on", () => {
		const workspaces = [
			workspace("active"),
			workspace("old", { state: "archived", archivedAt: 10 }),
		];
		const active = queryHome({
			workspaces,
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 1,
		});
		expect(active.items.map((row) => row.id)).toEqual(["active"]);

		const archived = queryHome({
			workspaces,
			repos: [repo("app")],
			filters: { ...FILTERS, archivedOnly: true },
			pageCount: 1,
		});
		expect(archived.items.map((row) => row.id)).toEqual(["old"]);
	});

	it("filters to the chosen projects", () => {
		const page = queryHome({
			workspaces: [
				workspace("one", { repoId: "app" as RepoId }),
				workspace("two", { repoId: "api" as RepoId }),
			],
			repos: [repo("app"), repo("api")],
			filters: { ...FILTERS, projects: ["api" as RepoId] },
			pageCount: 1,
		});
		expect(page.items.map((row) => row.id)).toEqual(["two"]);
	});

	it("puts pinned workspaces in their own group and out of the page", () => {
		const page = queryHome({
			workspaces: [workspace("pinned", { pinnedAt: 1 }), workspace("plain")],
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 1,
		});
		expect(page.pinned.map((row) => row.id)).toEqual(["pinned"]);
		expect(page.items.map((row) => row.id)).toEqual(["plain"]);
		expect(page.total).toBe(1);
	});

	it("sorts newest first by last activity or creation, with a stable tie-break", () => {
		const workspaces = [
			workspace("a", { lastActivityAt: 10, createdAt: 1 }),
			workspace("b", { lastActivityAt: 30, createdAt: 2 }),
			workspace("c", { lastActivityAt: 20, createdAt: 3 }),
		];
		const updated = queryHome({
			workspaces,
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 1,
		});
		expect(updated.items.map((row) => row.id)).toEqual(["b", "c", "a"]);

		const created = queryHome({
			workspaces,
			repos: [repo("app")],
			filters: { ...FILTERS, sortBy: "created" },
			pageCount: 1,
		});
		expect(created.items.map((row) => row.id)).toEqual(["c", "b", "a"]);
	});
});
