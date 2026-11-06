// @vitest-environment node
/**
 * @feature REV-03 Inline review comments with suggestions
 * Tests migration 0005: a review comment keeps the original code its suggestion replaces, and a
 * comment stored before the migration has none.
 * Test first: a comment written before 0005 reads back with a null suggestion base code.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import type { DiffCommentRow } from "./diff-comments.ts";
import { DIFF_COMMENTS_SQL, diffCommentFromRow, diffCommentToParams } from "./diff-comments.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { sampleComment, sampleRepo, sampleWorkspace } from "./test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "./workspaces.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

let store: ReturnType<typeof openTestDatabase>;

beforeEach(() => {
	store = openTestDatabase();
	store.raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	const workspace = workspaceToParams(sampleWorkspace);
	if (!workspace.ok) throw new Error(workspace.error.message);
	store.raw.prepare(WORKSPACES_SQL.insert).run(bind(workspace.value));
});

afterEach(() => {
	store.close();
});

describe("REV-03 migration 0005", () => {
	it("stores the code a suggestion replaces and gives it back", () => {
		store.raw
			.prepare(DIFF_COMMENTS_SQL.insert)
			.run(bind(diffCommentToParams({ ...sampleComment, suggestionBaseCode: "let name = 0;" })));

		const row = store.raw
			.prepare(DIFF_COMMENTS_SQL.get)
			.get(bind([sampleComment.id])) as unknown as DiffCommentRow;
		expect(diffCommentFromRow(row)).toMatchObject({
			suggestion: "const name = 1;",
			suggestionBaseCode: "let name = 0;",
		});
	});

	it("reads a comment stored without a base code as null", () => {
		store.raw
			.prepare(
				`INSERT INTO diff_comments (id, workspace_id, file_path, body, author_kind, created_at,
					updated_at) VALUES ('old', $1, 'a.ts', 'Older comment', 'user', 1, 1)`,
			)
			.run(bind([sampleWorkspace.id]));

		const row = store.raw
			.prepare(DIFF_COMMENTS_SQL.get)
			.get(bind(["old"])) as unknown as DiffCommentRow;
		expect(diffCommentFromRow(row).suggestionBaseCode).toBeNull();
	});
});
