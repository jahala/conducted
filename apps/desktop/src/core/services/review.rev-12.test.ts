/**
 * @feature REV-12 Review comment states
 * Tests the state moves the review service exposes: ready for review, hidden and back, reviewed
 * once a chat received the comment, and the attachment link to the comment it carried.
 */
import { appError, type CommentId, err, ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { createRepositories } from "../db/repositories.ts";
import { sampleSession } from "../db/test-fixtures.ts";
import type { GitRunner } from "../git/runner.ts";
import { ReviewService } from "./review.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

describe("REV-12 review comment states over the real container", () => {
	it("marks every pending comment ready, hides one and brings it back", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;

		const first = await review.add(workspace.id, "src/a.ts", 1, null, "First");
		const second = await review.add(workspace.id, "src/b.ts", 2, null, "Second");
		if (!first.ok || !second.ok) throw new Error("comments did not save");

		expect(await review.markAllReady(workspace.id)).toEqual(ok(undefined));
		expect(
			review.store.getState().byWorkspace[workspace.id]?.map((comment) => comment.state),
		).toEqual(["ready_for_review", "ready_for_review"]);

		expect(await review.setHidden(first.value.id, true)).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]?.[0]?.state).toBe("hidden");

		expect(await review.setHidden(first.value.id, false)).toEqual(ok(undefined));
		expect(review.store.getState().byWorkspace[workspace.id]?.map((c) => c.state)).toEqual([
			"pending",
			"ready_for_review",
		]);
	});

	it("marks a comment reviewed only after the chat accepted the message", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		const added = await review.add(workspace.id, "src/a.ts", 3, null, "Send me");
		if (!added.ok) throw new Error(added.error.message);
		const chat = await test.container.services.sessions.create(workspace.id, sampleSession.config);
		if (!chat.ok) throw new Error(chat.error.message);
		const send = vi
			.spyOn(test.container.services.sessions, "sendInstruction")
			.mockResolvedValue(ok(chat.value.id));

		expect(await review.sendToChat(workspace.id, [added.value.id])).toEqual(ok(undefined));
		expect(send).toHaveBeenCalledOnce();
		expect(review.store.getState().byWorkspace[workspace.id]?.[0]?.state).toBe("reviewed");
	});

	it("leaves a comment unreviewed when the chat refuses the message", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		const added = await review.add(workspace.id, "src/a.ts", 3, null, "Do not send");
		if (!added.ok) throw new Error(added.error.message);
		vi.spyOn(test.container.services.sessions, "sendInstruction").mockResolvedValue(
			err(appError("sidecar_unavailable", "The agent cannot start now.")),
		);

		const result = await review.sendToChat(workspace.id, [added.value.id]);

		expect(result.ok).toBe(false);
		expect(review.store.getState().byWorkspace[workspace.id]?.[0]?.state).toBe("pending");
	});

	it("finds the message and chat that carried a comment", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		const added = await review.add(workspace.id, "src/a.ts", 3, null, "Carried");
		if (!added.ok) throw new Error(added.error.message);
		const repositories = createRepositories(test.database, {
			clock: { now: () => 1_000 },
			ids: { uuid: () => crypto.randomUUID() },
		});
		const chat = await test.container.services.sessions.create(workspace.id, sampleSession.config);
		if (!chat.ok) throw new Error(chat.error.message);
		vi.spyOn(test.container.services.sessions, "sendInstruction").mockResolvedValue(
			ok(chat.value.id),
		);

		expect(await review.sendToChat(workspace.id, [added.value.id])).toEqual(ok(undefined));

		const fileName = `${encodeURIComponent(added.value.id)}.md`;
		const listed = await repositories.attachments.listBySession(chat.value.id);
		if (!listed.ok) throw new Error(listed.error.message);
		expect(listed.value.filter((row) => row.commentId === added.value.id)).toEqual([
			{
				id: expect.any(String),
				sessionId: chat.value.id,
				kind: "review",
				originalName: fileName,
				path: `${workspace.path}/.context/attachments/comments/${fileName}`,
				isDraft: false,
				commentId: added.value.id,
			},
		]);
		expect(await repositories.attachments.listDraftsBySession(chat.value.id)).toEqual(ok([]));
	});
});

describe("REV-12 hidden and superseded comments", () => {
	it("refuses to hide or bring back a superseded comment", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		const added = await review.add(workspace.id, "src/a.ts", 1, null, "Frozen");
		if (!added.ok) throw new Error(added.error.message);
		const repositories = createRepositories(test.database, {
			clock: { now: () => 1_000 },
			ids: { uuid: () => crypto.randomUUID() },
		});
		await test.database.execute("UPDATE diff_comments SET state = 'superseded' WHERE id = $1", [
			added.value.id,
		]);

		const hidden = await review.setHidden(added.value.id, true);
		const shown = await review.setHidden(added.value.id, false);

		expect(hidden).toMatchObject({ ok: false, error: { code: "review_comment_superseded" } });
		expect(shown).toMatchObject({ ok: false, error: { code: "review_comment_superseded" } });
		expect(await repositories.diffComments.get(added.value.id)).toMatchObject({
			ok: true,
			value: { state: "superseded" },
		});
	});

	it("keeps a reviewed comment reviewed when it is 'brought back' without being hidden", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const review = test.container.services.review;
		const added = await review.add(workspace.id, "src/a.ts", 1, null, "Sent before");
		if (!added.ok) throw new Error(added.error.message);
		const chat = await test.container.services.sessions.create(workspace.id, sampleSession.config);
		if (!chat.ok) throw new Error(chat.error.message);
		vi.spyOn(test.container.services.sessions, "sendInstruction").mockResolvedValue(
			ok(chat.value.id),
		);
		expect(await review.sendToChat(workspace.id, [added.value.id])).toEqual(ok(undefined));

		expect(await review.setHidden(added.value.id, false)).toEqual(ok(undefined));

		expect(review.store.getState().byWorkspace[workspace.id]?.[0]?.state).toBe("reviewed");
	});
});

describe("REV-12 a send the chat took but the app could not record", () => {
	it("says the comments reached the chat and marks none of them half way", async () => {
		test = createTestContainer();
		const harness = test;
		const workspace = await seedWorkspace(harness.container);
		const repositories = createRepositories(harness.database, {
			clock: { now: () => 1_000 },
			ids: { uuid: () => crypto.randomUUID() },
		});
		const chat = await harness.container.services.sessions.create(
			workspace.id,
			sampleSession.config,
		);
		if (!chat.ok) throw new Error(chat.error.message);
		const sent: string[] = [];
		const review = new ReviewService({
			repos: repositories,
			git: {} as GitRunner,
			agent: {
				sendInstruction: async (_workspaceId, text) => {
					sent.push(text);
					return ok(chat.value.id);
				},
			},
			fs: harness.container.platform.fs,
			workspacePathOf: async () => ok(workspace.path),
			customPromptOf: async () => ok(null),
			startReviewChat: async () => err(appError("not_used", "No review chat in this test.")),
		});
		const ids: CommentId[] = [];
		for (const body of ["One", "Two", "Three"]) {
			const added = await review.add(workspace.id, "src/a.ts", ids.length + 1, null, body);
			if (!added.ok) throw new Error(added.error.message);
			ids.push(added.value.id);
		}
		vi.spyOn(repositories.diffComments, "markReviewed").mockResolvedValue(
			err(appError("db.locked", "The database is locked.")),
		);

		const result = await review.sendToChat(workspace.id, ids);

		expect(result).toMatchObject({ ok: false, error: { code: "review_sent_not_recorded" } });
		expect(sent).toHaveLength(1);
		expect(review.store.getState().byWorkspace[workspace.id]?.map((c) => c.state)).toEqual([
			"pending",
			"pending",
			"pending",
		]);
	});
});
