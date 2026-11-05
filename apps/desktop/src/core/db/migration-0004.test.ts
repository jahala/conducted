// @vitest-environment node
import type { DatabaseSync } from "node:sqlite";
import type { AttachmentId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { ATTACHMENTS_SQL, attachmentToParams } from "./attachments.ts";
import type { DiffCommentRow } from "./diff-comments.ts";
import { DIFF_COMMENTS_SQL, diffCommentFromRow, diffCommentToParams } from "./diff-comments.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories } from "./repositories.ts";
import { SESSIONS_SQL, sessionToParams } from "./sessions.ts";
import { TERMINALS_SQL, terminalToParams } from "./terminals.ts";
import {
	sampleAttachment,
	sampleComment,
	sampleRepo,
	sampleSession,
	sampleTerminal,
	sampleWorkspace,
} from "./test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "./workspaces.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let store: ReturnType<typeof openTestDatabase>;
let raw: DatabaseSync;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
});

afterEach(() => {
	store.close();
});

const run = (sql: string, params: readonly unknown[] = []): number =>
	Number(raw.prepare(sql).run(bind(params)).changes);

const rows = <Row>(sql: string, params: readonly unknown[] = []): Row[] =>
	raw.prepare(sql).all(bind(params)) as Row[];

const columns = (table: string): string[] =>
	rows<{ name: string }>(`PRAGMA table_info(${table})`).map((column) => column.name);

const seedWorkspace = (): void => {
	run(REPOS_SQL.insert, repoToParams(sampleRepo));
	run(WORKSPACES_SQL.insert, must(workspaceToParams(sampleWorkspace)));
	run(SESSIONS_SQL.insert, must(sessionToParams(sampleSession)));
};

describe("DATA-08 migration 0004 store columns", () => {
	it("workspaces carry archived_at and an archived row records it", async () => {
		expect(columns("workspaces")).toContain("archived_at");
		run(REPOS_SQL.insert, repoToParams(sampleRepo));
		run(WORKSPACES_SQL.insert, must(workspaceToParams({ ...sampleWorkspace, state: "archiving" })));
		const repositories = createRepositories(store.database, {
			clock: { now: () => 6000 },
			ids: { uuid: () => "unused" },
		});
		expect(await repositories.workspaces.markArchived(sampleWorkspace.id, "abc123")).toEqual({
			ok: true,
			value: true,
		});
		expect(
			rows<{ state: string; archived_at: number }>(
				"SELECT state, archived_at FROM workspaces WHERE id = $1",
				[sampleWorkspace.id],
			),
		).toEqual([{ state: "archived", archived_at: 6000 }]);
	});

	it("attachments accept the pdf and review kinds and link a review comment", () => {
		seedWorkspace();
		run(DIFF_COMMENTS_SQL.insert, diffCommentToParams(sampleComment));
		run(
			ATTACHMENTS_SQL.insert,
			attachmentToParams({
				...sampleAttachment,
				id: "att-pdf" as AttachmentId,
				kind: "pdf",
				commentId: null,
			}),
		);
		run(
			ATTACHMENTS_SQL.insert,
			attachmentToParams({
				...sampleAttachment,
				id: "att-review" as AttachmentId,
				kind: "review",
				commentId: sampleComment.id,
			}),
		);
		expect(
			rows<{ kind: string; comment_id: string | null }>(
				"SELECT kind, comment_id FROM attachments ORDER BY id",
			),
		).toEqual([
			{ kind: "pdf", comment_id: null },
			{ kind: "review", comment_id: sampleComment.id },
		]);
		expect(() =>
			run(
				ATTACHMENTS_SQL.insert,
				attachmentToParams({
					...sampleAttachment,
					id: "att-unknown" as AttachmentId,
					kind: "video" as never,
				}),
			),
		).toThrow();

		run(DIFF_COMMENTS_SQL.delete, [sampleComment.id]);
		expect(
			rows<{ comment_id: string | null }>("SELECT comment_id FROM attachments WHERE id = $1", [
				"att-review",
			]),
		).toEqual([{ comment_id: null }]);
	});

	it("review comments carry state, location and the author avatar", () => {
		seedWorkspace();
		expect(columns("diff_comments")).toEqual(
			expect.arrayContaining(["state", "location", "author_avatar_url"]),
		);
		run(DIFF_COMMENTS_SQL.insert, diffCommentToParams(sampleComment));
		const row = rows<DiffCommentRow>(DIFF_COMMENTS_SQL.get, [sampleComment.id])[0];
		if (row === undefined) throw new Error("the review comment was not stored");
		expect(diffCommentFromRow(row)).toMatchObject({
			state: "hidden",
			side: "deletions",
			author: sampleComment.author,
		});
	});

	it("workspaces remember the active chat", () => {
		seedWorkspace();
		expect(columns("workspaces")).toContain("active_session_id");
		run("UPDATE workspaces SET active_session_id = $1 WHERE id = $2", [
			sampleSession.id,
			sampleWorkspace.id,
		]);
		expect(
			rows<{ active_session_id: string | null }>(
				"SELECT active_session_id FROM workspaces WHERE id = $1",
				[sampleWorkspace.id],
			),
		).toEqual([{ active_session_id: sampleSession.id }]);
	});

	it("terminals keep the screen modes and can belong to a repository", () => {
		seedWorkspace();
		expect(columns("terminals")).toEqual(expect.arrayContaining(["repo_id", "screen_state"]));
		const screenState = '{"alternateScreen":true}';
		run(TERMINALS_SQL.insert, terminalToParams({ ...sampleTerminal, screenState }));
		expect(
			rows<{ screen_state: string }>(TERMINALS_SQL.getScreenState, [sampleTerminal.id]),
		).toEqual([{ screen_state: screenState }]);
	});
});
