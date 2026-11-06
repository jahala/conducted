// @vitest-environment node
/**
 * @feature CHAT-16 Fork a chat from a turn
 * Tests migration 0007: a forked chat stores where its agent resumes, a chat stored before the
 * migration has no resume point, and the fork's first user message clears it in the same write
 * that records the message.
 * Test first: a resume point written for a chat reads back after the database is reopened.
 */
import type { SessionId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestIds } from "../../test/ids.ts";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { SESSIONS_SQL, sessionToParams } from "./sessions.ts";
import { sampleRepo, sampleSession, sampleWorkspace } from "./test-fixtures.ts";
import { WORKSPACES_SQL, workspaceToParams } from "./workspaces.ts";

const bind = (params: readonly unknown[]): Record<string, never> =>
	Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])) as never;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let store: ReturnType<typeof openTestDatabase>;
let repositories: Repositories;

beforeEach(() => {
	store = openTestDatabase();
	repositories = createRepositories(store.database, {
		clock: { now: () => 1000 },
		ids: createTestIds(),
	});
	store.raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	store.raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
	store.raw.prepare(SESSIONS_SQL.insert).run(bind(must(sessionToParams(sampleSession))));
});

afterEach(() => {
	store.close();
});

describe("CHAT-16 migration 0007", () => {
	it("stores a fork's resume point and reads it back", async () => {
		must(await repositories.sessions.setForkResume(sampleSession.id, "native-7"));
		expect(must(await repositories.sessions.get(sampleSession.id))?.forkResumeNativeMessageId).toBe(
			"native-7",
		);
	});

	it("reads a chat stored without a resume point as null", async () => {
		store.raw
			.prepare(
				`INSERT INTO sessions (id, workspace_id, config, created_at, updated_at)
				VALUES ('older', $1, $2, 1, 1)`,
			)
			.run(bind([sampleWorkspace.id, JSON.stringify(sampleSession.config)]));
		expect(
			must(await repositories.sessions.get("older" as SessionId))?.forkResumeNativeMessageId,
		).toBeNull();
	});

	it("clears the resume point when the chat's first user message is recorded", async () => {
		must(await repositories.sessions.setForkResume(sampleSession.id, "native-7"));
		must(await repositories.sessions.recordUserMessage(sampleSession.id, 5000));
		expect(must(await repositories.sessions.get(sampleSession.id))).toMatchObject({
			lastUserMessageAt: 5000,
			forkResumeNativeMessageId: null,
		});
	});
});
