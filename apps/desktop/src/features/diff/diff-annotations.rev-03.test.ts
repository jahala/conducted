/**
 * @feature REV-03 Comment annotations
 * Tests the mapping from stored comments to the renderer's annotations.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { DiffComment } from "../../core/model.ts";
import { commentsToAnnotations } from "./diff-annotations.ts";

const workspaceId = "ws-1" as WorkspaceId;

function comment(over: Partial<DiffComment> = {}): DiffComment {
	return {
		id: "c-1" as CommentId,
		workspaceId,
		filePath: "a.ts",
		line: 7,
		endLine: null,
		body: "Body",
		author: { kind: "user", name: null, avatarUrl: null },
		state: "pending",
		side: "additions",
		threadId: "t-1",
		replyToId: null,
		suggestion: null,
		remoteUrl: null,
		resolved: false,
		outdated: false,
		createdAt: 1000,
		updatedAt: 1000,
		...over,
	};
}

describe("REV-03 commentsToAnnotations", () => {
	it("puts two comments of one thread on line 7 into one annotation with both ids", () => {
		const annotations = commentsToAnnotations(
			[
				comment({ id: "c-1" as CommentId, createdAt: 1000 }),
				comment({ id: "c-2" as CommentId, createdAt: 2000 }),
			],
			"a.ts",
		);

		expect(annotations).toHaveLength(1);
		expect(annotations[0]).toMatchObject({
			side: "additions",
			lineNumber: 7,
			metadata: { threadIds: ["t-1"], commentIds: ["c-1", "c-2"] },
		});
	});

	it("groups a reply under its root when only replyToId names the thread", () => {
		const annotations = commentsToAnnotations(
			[
				comment({ id: "c-1" as CommentId, threadId: null, line: 4 }),
				comment({
					id: "c-2" as CommentId,
					threadId: null,
					replyToId: "c-1" as CommentId,
					line: 9,
					createdAt: 2000,
				}),
			],
			"a.ts",
		);

		expect(annotations).toHaveLength(1);
		expect(annotations[0]?.lineNumber).toBe(4);
		expect(annotations[0]?.metadata.commentIds).toEqual(["c-1", "c-2"]);
	});

	it("draws two threads on one line as one annotation holding both thread ids", () => {
		const annotations = commentsToAnnotations(
			[comment({ id: "c-1" as CommentId }), comment({ id: "c-2" as CommentId, threadId: "t-2" })],
			"a.ts",
		);

		expect(annotations).toHaveLength(1);
		expect(annotations[0]?.metadata.threadIds).toEqual(["t-1", "t-2"]);
	});

	it("anchors a multi-line comment at its end line and keeps its side", () => {
		const annotations = commentsToAnnotations(
			[comment({ line: 3, endLine: 6, side: "deletions" })],
			"a.ts",
		);

		expect(annotations[0]).toMatchObject({ side: "deletions", lineNumber: 6 });
	});

	it("puts a whole-file comment and an outdated comment at the top of the file", () => {
		const annotations = commentsToAnnotations(
			[
				comment({ id: "c-1" as CommentId, line: null }),
				comment({
					id: "c-2" as CommentId,
					line: 9,
					outdated: true,
					side: "deletions",
					threadId: "t-2",
				}),
			],
			"a.ts",
		);

		expect(annotations.map((annotation) => annotation.lineNumber)).toEqual([0, 0]);
	});

	it("leaves out comments on another file", () => {
		const annotations = commentsToAnnotations(
			[comment({ filePath: "b.ts" }), comment({ id: "c-2" as CommentId })],
			"a.ts",
		);

		expect(annotations).toHaveLength(1);
		expect(annotations[0]?.metadata.commentIds).toEqual(["c-2"]);
	});
});
