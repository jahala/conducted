/**
 * @feature NAV-06 Kanban columns and grouping
 * Owns: tests for the column list that the status menu and the sidebar's status groups read.
 * Test first: the statuses come in board order, and each has the label the board shows.
 */
import { describe, expect, it } from "vitest";
import { KANBAN_COLUMNS, KANBAN_STATUSES } from "./kanban.ts";

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
