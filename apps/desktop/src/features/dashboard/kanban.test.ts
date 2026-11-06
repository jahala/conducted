/**
 * @feature NAV-06 Kanban columns and grouping
 * Owns: tests for the column list, the status colours and the grouping function that the board,
 * the status menu and the sidebar's status groups read.
 * Test first: five workspaces with five different statuses give one card in each column.
 */
import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "../../core/db/test-fixtures.ts";
import type { KanbanStatus, Workspace } from "../../core/model.ts";
import {
	groupByKanbanStatus,
	KANBAN_COLUMNS,
	KANBAN_STATUSES,
	KANBAN_STATUS_MARK,
} from "./kanban.ts";

function workspace(
	id: string,
	status: KanbanStatus,
	overrides: Partial<Workspace> = {},
): Workspace {
	return {
		...sampleWorkspace,
		id: id as Workspace["id"],
		kanbanStatus: status,
		archivedAt: null,
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

	it("gives every status its own colour token", () => {
		const marks = KANBAN_STATUSES.map((status) => KANBAN_STATUS_MARK[status]);
		expect(new Set(marks).size).toBe(KANBAN_STATUSES.length);
		for (const mark of marks) expect(mark.startsWith("bg-status-")).toBe(true);
		expect(KANBAN_STATUS_MARK.in_progress).toBe("bg-status-progress");
		expect(KANBAN_STATUS_MARK.in_review).toBe("bg-status-review");
		expect(KANBAN_STATUS_MARK.canceled).toBe("bg-status-canceled");
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
		for (const status of KANBAN_STATUSES) {
			expect(groups[status]).toHaveLength(1);
			expect(groups[status][0]?.kanbanStatus).toBe(status);
		}
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
