// @vitest-environment node
import type { DatabaseSync } from "node:sqlite";
import { ok } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { SESSIONS_SQL, sessionToParams } from "./sessions.ts";
import { sampleComment, sampleRepo, sampleSession, sampleWorkspace } from "./test-fixtures.ts";
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
let nextId: number;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	nextId = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => 1_000 },
		ids: { uuid: () => `rev-12-attachment-${++nextId}` },
	});
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
	raw.prepare(SESSIONS_SQL.insert).run(bind(must(sessionToParams(sampleSession))));
});

afterEach(() => {
	store.close();
});

describe("REV-12 an attachment points at the comment it carried", () => {
	it("lists only the attachments that carried the review comment", async () => {
		const comment = must(
			await repositories.diffComments.add({
				workspaceId: sampleWorkspace.id,
				filePath: "src/app.ts",
				line: 4,
				endLine: null,
				body: "Sent to chat",
				author: { kind: "user", name: null, avatarUrl: null },
				side: "additions",
				threadId: null,
				replyToId: null,
				suggestion: null,
				suggestionBaseCode: null,
			}),
		);
		const carried = must(
			await repositories.attachments.addDraft({
				sessionId: sampleSession.id,
				kind: "review",
				originalName: `${encodeURIComponent(comment.id)}.md`,
				path: "/data/draft-attachments/chat-1/comment.md",
				commentId: comment.id,
			}),
		);
		must(
			await repositories.attachments.addDraft({
				sessionId: sampleSession.id,
				kind: "text",
				originalName: "notes.txt",
				path: "/data/draft-attachments/chat-1/notes.txt",
				commentId: null,
			}),
		);

		expect(await repositories.attachments.listByComment(comment.id)).toEqual(ok([carried]));
		expect(await repositories.attachments.listByComment(sampleComment.id)).toEqual(ok([]));
	});
});
