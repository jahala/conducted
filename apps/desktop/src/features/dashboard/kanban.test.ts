/**
 * @feature NAV-06 Kanban columns and grouping
 * Owns: tests for the column list and the grouping function that the board, the status menu and
 * the sidebar's status groups read.
 * Test first: five workspaces with five different statuses give one card in each column.
 */
import { describe, expect, it } from "vitest";
import type { KanbanStatus, Workspace } from "../../core/model.ts";
import { groupByKanbanStatus, KANBAN_COLUMNS, KANBAN_STATUSES } from "./kanban.ts";

function workspace(
	id: string,
	status: KanbanStatus,
	overrides: Partial<Workspace> = {},
): Workspace {
	return {
		id: id as Workspace["id"],
		repoId: "repo-1" as Workspace["repoId"],
		directoryName: id,
		path: `/code/workspaces/${id}`,
		branch: `jahala/${id}`,
		branchIsPlaceholder: false,
		displayName: null,
		targetBranch: "origin/main",
		state: "ready",
		kanbanStatus: status,
		port: 55_100,
		pinnedAt: null,
		notes: "",
		linkedPaths: [],
		prNumber: null,
		prTitle: null,
		prDescription: null,
		archiveCommit: null,
		archivedAt: null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 1000,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

describe("NAV-06 kanban columns", () => {
	it("lists every status once, in board order", () => {
		expect([...KANBAN_STATUSES]).toEqual([
			"backlog",
			"in_progress",
			"in_review",
			"done",
			"canceled",
		]);
		expect(new Set(KANBAN_STATUSES).size).toBe(Object.keys(KANBAN_COLUMNS).length);
	});

	it("gives each status its board label", () => {
		expect(KANBAN_COLUMNS.in_review.label).toBe("In review");
		expect(KANBAN_COLUMNS.canceled.label).toBe("Canceled");
	});
});

describe("NAV-06 grouping workspaces", () => {
	it("puts five workspaces with five different statuses in one card each", () => {
		const groups = groupByKanbanStatus([
			workspace("b", "backlog"),
			workspace("p", "in_progress"),
			workspace("r", "in_review"),
			workspace("d", "done"),
			workspace("c", "canceled"),
		]);
		expect(groups.backlog.map((row) => row.id)).toEqual(["b"]);
		expect(groups.in_progress.map((row) => row.id)).toEqual(["p"]);
		expect(groups.in_review.map((row) => row.id)).toEqual(["r"]);
		expect(groups.done.map((row) => row.id)).toEqual(["d"]);
		expect(groups.canceled.map((row) => row.id)).toEqual(["c"]);
	});

	it("leaves archived workspaces off the board", () => {
		const groups = groupByKanbanStatus([
			workspace("live", "backlog"),
			workspace("gone", "backlog", { state: "archived", archivedAt: 5 }),
		]);
		expect(groups.backlog.map((row) => row.id)).toEqual(["live"]);
	});

	it("orders a column by last activity, newest first, with a stable tie-break", () => {
		const groups = groupByKanbanStatus([
			workspace("old", "done", { lastActivityAt: 100 }),
			workspace("new", "done", { lastActivityAt: 300 }),
			workspace("middle-b", "done", { lastActivityAt: 200 }),
			workspace("middle-a", "done", { lastActivityAt: 200 }),
		]);
		expect(groups.done.map((row) => row.id)).toEqual(["new", "middle-a", "middle-b", "old"]);
	});
});
