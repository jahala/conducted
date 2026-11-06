// @vitest-environment node
//
// Pins DATA-08's design choice for a review comment on the pull request itself. Migration 0004
// keeps diff_comments.file_path NOT NULL and stores an empty string with location 'pull_request';
// the model exposes that comment's filePath as null (REV-13).
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestIds } from "../../test/ids.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { DIFF_COMMENTS_SQL, type DiffCommentRow } from "./diff-comments.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { sampleRepo, sampleWorkspace } from "./test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "./workspaces.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let store: ReturnType<typeof openTestDatabase>;
let raw: DatabaseSync;
let repositories: Repositories;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	repositories = createRepositories(store.database, {
		clock: { now: () => 5000 },
		ids: createTestIds("comment"),
	});
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
});

afterEach(() => {
	store.close();
});

describe("DATA-08 a review comment on the pull request itself", () => {
	it("stores an empty file path with location pull_request and reads it back as null", async () => {
		const comment = must(
			await repositories.diffComments.add({
				workspaceId: sampleWorkspace.id,
				filePath: null,
				line: null,
				endLine: null,
				body: "The pull request needs a description.",
				author: { kind: "github", name: "octocat", avatarUrl: null },
				side: "additions",
				threadId: null,
				replyToId: null,
				suggestion: null,
			}),
		);
		expect(comment.filePath).toBeNull();

		const row = raw.prepare(DIFF_COMMENTS_SQL.get).all(bind([comment.id]))[0] as
			| DiffCommentRow
			| undefined;
		if (row === undefined) throw new Error("the pull request comment was not stored");
		expect(row.file_path).toBe("");
		expect(row.location).toBe("pull_request");

		expect(must(await repositories.diffComments.get(comment.id))).toEqual(comment);
	});
});
