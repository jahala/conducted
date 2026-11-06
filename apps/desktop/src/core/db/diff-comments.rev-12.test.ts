// @vitest-environment node
import type { DatabaseSync } from "node:sqlite";
import { type CommentId, ok, type WorkspaceId } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";
import { REPOS_SQL, repoToParams } from "./repos.ts";
import { createRepositories, type Repositories } from "./repositories.ts";
import { sampleComment, sampleRepo, sampleWorkspace } from "./test-fixtures.ts";
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
let now: number;
let nextId: number;

beforeEach(() => {
	store = openTestDatabase();
	raw = store.raw;
	now = 1_000;
	nextId = 0;
	repositories = createRepositories(store.database, {
		clock: { now: () => now },
		ids: { uuid: () => `rev-12-${++nextId}` },
	});
	raw.prepare(REPOS_SQL.insert).run(bind(repoToParams(sampleRepo)));
	raw.prepare(WORKSPACES_SQL.insert).run(bind(must(workspaceToParams(sampleWorkspace))));
});

afterEach(() => {
	store.close();
});

const add = (body: string) =>
	repositories.diffComments.add({
		workspaceId: sampleWorkspace.id,
		filePath: "src/app.ts",
		line: 4,
		endLine: null,
		body,
		author: { kind: "user", name: null, avatarUrl: null },
		side: "additions",
		threadId: null,
		replyToId: null,
		suggestion: null,
	});

describe("REV-12 review comment state in the repository", () => {
	it("stores every state in the documented order", async () => {
		const comment = must(await add("One comment"));
		const states = [
			"draft",
			"pending",
			"ready_for_review",
			"reviewed",
			"hidden",
			"superseded",
		] as const;
		for (const state of states) {
			now += 1;
			expect(await repositories.diffComments.setState(comment.id, state)).toEqual(ok(undefined));
			expect(must(await repositories.diffComments.get(comment.id))).toMatchObject({ state });
		}
	});

	it("marks every open pending comment ready in one step", async () => {
		const pending = must(await add("Pending"));
		const resolved = must(await add("Resolved"));
		const outdated = must(await add("Outdated"));
		const reviewed = must(await add("Reviewed"));
		must(await repositories.diffComments.setResolved(resolved.id, true));
		must(await repositories.diffComments.setOutdated(outdated.id, true));
		must(await repositories.diffComments.setState(reviewed.id, "reviewed"));

		expect(await repositories.diffComments.markReadyForReview(sampleWorkspace.id)).toEqual({
			ok: true,
			value: 1,
		});

		expect(must(await repositories.diffComments.get(pending.id))?.state).toBe("ready_for_review");
		expect(must(await repositories.diffComments.get(resolved.id))?.state).toBe("pending");
		expect(must(await repositories.diffComments.get(outdated.id))?.state).toBe("pending");
		expect(must(await repositories.diffComments.get(reviewed.id))?.state).toBe("reviewed");
	});

	it("supersedes a workspace's comments together and leaves another workspace alone", async () => {
		raw.prepare(WORKSPACES_SQL.insert).run(
			bind(
				must(
					workspaceToParams({
						...sampleWorkspace,
						id: "ws-2" as WorkspaceId,
						directoryName: "lisbon",
						path: "/code/workspaces/lisbon",
					}),
				),
			),
		);
		const here = must(await add("Here"));
		const elsewhere = must(
			await repositories.diffComments.add({
				workspaceId: "ws-2" as WorkspaceId,
				filePath: "src/other.ts",
				line: 1,
				endLine: null,
				body: "Elsewhere",
				author: { kind: "user", name: null, avatarUrl: null },
				side: "additions",
				threadId: null,
				replyToId: null,
				suggestion: null,
			}),
		);

		expect(await repositories.diffComments.supersedeWorkspace(sampleWorkspace.id)).toEqual({
			ok: true,
			value: 1,
		});

		expect(must(await repositories.diffComments.get(here.id))?.state).toBe("superseded");
		expect(must(await repositories.diffComments.get(elsewhere.id))?.state).toBe("pending");
		expect(await repositories.diffComments.supersedeWorkspace(sampleWorkspace.id)).toEqual({
			ok: true,
			value: 0,
		});
	});
});

describe("REV-12 GitHub comments keep a hidden or reviewed state", () => {
	it("keeps a hidden comment hidden until GitHub edits its body", async () => {
		const hidden = { ...sampleComment, state: "hidden" as const, body: "Original" };
		must(await repositories.diffComments.syncRemote(sampleWorkspace.id, [hidden]));

		must(
			await repositories.diffComments.syncRemote(sampleWorkspace.id, [
				{ ...hidden, line: 40, body: "Original" },
			]),
		);
		expect(must(await repositories.diffComments.get(hidden.id))).toMatchObject({
			state: "hidden",
			line: 10,
			body: "Original",
		});

		must(
			await repositories.diffComments.syncRemote(sampleWorkspace.id, [
				{ ...hidden, body: "Edited on GitHub" },
			]),
		);
		expect(must(await repositories.diffComments.get(hidden.id))).toMatchObject({
			state: "pending",
			body: "Edited on GitHub",
		});

		must(await repositories.diffComments.setState(hidden.id, "reviewed"));
		must(
			await repositories.diffComments.syncRemote(sampleWorkspace.id, [
				{ ...hidden, body: "Edited again" },
			]),
		);
		expect(must(await repositories.diffComments.get(hidden.id))).toMatchObject({
			state: "pending",
			body: "Edited again",
		});
	});

	it("never updates a superseded comment and never deletes it with the GitHub rows", async () => {
		const first = { ...sampleComment, state: "pending" as const, body: "First" };
		const second = { ...sampleComment, id: "c-2" as CommentId, body: "Second" };
		must(await repositories.diffComments.syncRemote(sampleWorkspace.id, [first, second]));
		must(await repositories.diffComments.setState(first.id, "superseded"));

		must(
			await repositories.diffComments.syncRemote(sampleWorkspace.id, [
				{ ...first, body: "Rewritten" },
			]),
		);
		expect(must(await repositories.diffComments.get(first.id))).toMatchObject({
			state: "superseded",
			body: "First",
		});

		must(await repositories.diffComments.syncRemote(sampleWorkspace.id, []));
		expect(must(await repositories.diffComments.get(first.id))?.state).toBe("superseded");
		expect(must(await repositories.diffComments.get(second.id))).toBeNull();
	});
});
