import type { RepoId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Repo, Workspace } from "../../core/model.ts";
import { HOME_PAGE_SIZE, type HomeFilterState, queryHome } from "./home-query.ts";

const FILTERS: HomeFilterState = {
	search: "",
	projects: [],
	archive: "active",
	sortBy: "lastActive",
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
		host: { kind: "local" },
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

	it("finds a workspace by display name", () => {
		const page = queryHome({
			workspaces: [
				workspace("one", { displayName: "Fix the login" }),
				workspace("two", { displayName: "Update docs" }),
			],
			repos: [repo("app")],
			filters: { ...FILTERS, search: "login" },
			pageCount: 1,
		});
		expect(page.items.map((row) => row.id)).toEqual(["one"]);
	});

	it("finds a workspace by pull request title", () => {
		const page = queryHome({
			workspaces: [
				workspace("one", { displayName: "one", prTitle: "Fix the login" }),
				workspace("two", { displayName: "two" }),
			],
			repos: [repo("app")],
			filters: { ...FILTERS, search: "login" },
			pageCount: 1,
		});
		expect(page.items.map((row) => row.id)).toEqual(["one"]);
	});

	it("matches the repository name as well as the workspace fields", () => {
		const page = queryHome({
			workspaces: [
				workspace("one", { repoId: "svc-1" as RepoId, displayName: "one" }),
				workspace("two", { repoId: "app" as RepoId, displayName: "two" }),
			],
			repos: [repo("app"), repo("svc-1", { name: "api-service" })],
			filters: { ...FILTERS, search: "api" },
			pageCount: 1,
		});
		expect(page.items.map((row) => row.id)).toEqual(["one"]);
	});

	it("grows by 50 per page and reports the rest", () => {
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

		// Paging is cumulative: "Show more" keeps the first page and adds the second.
		const second = queryHome({
			workspaces,
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 2,
		});
		expect(second.items).toHaveLength(60);
		expect(second.hasMore).toBe(false);
	});

	it("returns every match when more pages are asked for than exist", () => {
		const page = queryHome({
			workspaces: [workspace("one")],
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 9,
		});
		expect(page.items.map((row) => row.id)).toEqual(["one"]);
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
			filters: { ...FILTERS, archive: "archived" },
			pageCount: 1,
		});
		expect(archived.items.map((row) => row.id)).toEqual(["old"]);
	});

	it("treats a workspace with an archived date as archived before its state catches up", () => {
		const staleState = workspace("old", { state: "ready", archivedAt: 10 });
		const active = queryHome({
			workspaces: [staleState],
			repos: [repo("app")],
			filters: FILTERS,
			pageCount: 1,
		});
		expect(active.items).toEqual([]);

		const archived = queryHome({
			workspaces: [staleState],
			repos: [repo("app")],
			filters: { ...FILTERS, archive: "archived" },
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

	it("shows active and archived workspaces together when Showing all", () => {
		const page = queryHome({
			workspaces: [workspace("active"), workspace("old", { state: "archived", archivedAt: 10 })],
			repos: [repo("app")],
			filters: { ...FILTERS, archive: "all" },
			pageCount: 1,
		});
		expect(page.items.map((row) => row.id).sort()).toEqual(["active", "old"]);
	});

	it("sorts by name A to Z ignoring case, and by repository name", () => {
		const workspaces = [
			workspace("b", { displayName: "beta", repoId: "zed" as RepoId }),
			workspace("a", { displayName: "Alpha", repoId: "app" as RepoId }),
			workspace("c", { displayName: "charlie", repoId: "api" as RepoId }),
		];
		const repos = [repo("zed"), repo("app"), repo("api")];
		const byName = queryHome({
			workspaces,
			repos,
			filters: { ...FILTERS, sortBy: "name" },
			pageCount: 1,
		});
		expect(byName.items.map((row) => row.id)).toEqual(["a", "b", "c"]);
		const byRepo = queryHome({
			workspaces,
			repos,
			filters: { ...FILTERS, sortBy: "repository" },
			pageCount: 1,
		});
		expect(byRepo.items.map((row) => row.id)).toEqual(["c", "a", "b"]);
	});
});
