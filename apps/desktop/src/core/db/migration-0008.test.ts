// @vitest-environment node
/**
 * @feature WS-11 Backlog workspaces: add now, start later
 * Tests migration 0008: a backlog workspace may have no repository, and removing its repository
 * keeps the draft with none instead of deleting it.
 * Test first: backlog_workspaces.repo_id is nullable and its foreign key sets null on delete.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";

let store: ReturnType<typeof openTestDatabase>;

beforeEach(() => {
	store = openTestDatabase();
});

afterEach(() => {
	store.close();
});

describe("WS-11 migration 0008", () => {
	it("lets a backlog workspace outlive its repository", () => {
		const repoColumn = (
			store.raw.prepare("PRAGMA table_info(backlog_workspaces)").all() as {
				name: string;
				notnull: number;
			}[]
		).find((column) => column.name === "repo_id");
		expect(repoColumn?.notnull).toBe(0);

		const keys = store.raw.prepare("PRAGMA foreign_key_list(backlog_workspaces)").all() as {
			table: string;
			from: string;
			on_delete: string;
		}[];
		expect(keys.find((key) => key.from === "repo_id")).toMatchObject({
			table: "repos",
			on_delete: "SET NULL",
		});

		const indexes = store.raw.prepare("PRAGMA index_list(backlog_workspaces)").all() as {
			name: string;
		}[];
		expect(indexes.map((index) => index.name)).toContain("idx_backlog_workspaces_repo");
	});
});
