/**
 * @feature REV-12 Review comment states
 * Tests the state moves the review service exposes: ready for review, hidden and back, reviewed
 * once a chat received the comment, and the attachment link to the comment it carried.
 */
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { createRepositories } from "../db/repositories.ts";
import { sampleSession } from "../db/test-fixtures.ts";

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
		const send = vi
			.spyOn(test.container.services.sessions, "sendInstruction")
			.mockResolvedValue(ok("chat-1" as SessionId));

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
		const attachment = await repositories.attachments.addDraft({
			sessionId: chat.value.id,
			kind: "review",
			originalName: `${encodeURIComponent(added.value.id)}.md`,
			path: "/data/draft-attachments/chat/comment.md",
			commentId: added.value.id,
		});
		if (!attachment.ok) throw new Error(attachment.error.message);

		expect(await repositories.attachments.listByComment(added.value.id)).toEqual(
			ok([attachment.value]),
		);
	});
});
