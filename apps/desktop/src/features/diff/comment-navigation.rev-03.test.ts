/**
 * @feature REV-03 Comment navigation
 * Tests the previous and next comment order across files.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { DiffComment } from "../../core/model.ts";
import { nextComment } from "./comment-navigation.ts";

const workspaceId = "ws-1" as WorkspaceId;

function comment(id: string, filePath: string, line: number, over: Partial<DiffComment> = {}) {
	return {
		id: id as CommentId,
		workspaceId,
		filePath,
		line,
		endLine: null,
		body: id,
		author: { kind: "user", name: null, avatarUrl: null },
		state: "pending",
		side: "additions",
		threadId: null,
		replyToId: null,
		suggestion: null,
		remoteUrl: null,
		resolved: false,
		outdated: false,
		createdAt: line,
		updatedAt: line,
		...over,
	} satisfies DiffComment;
}

const comments = [comment("a3", "a.ts", 3), comment("a9", "a.ts", 9), comment("b1", "b.ts", 1)];

describe("REV-03 nextComment", () => {
	it("moves to the next file and wraps to the first comment", () => {
		expect(nextComment(comments, "a9", "next")?.id).toBe("b1");
		expect(nextComment(comments, "b1", "next")?.id).toBe("a3");
	});

	it("moves backwards and wraps to the last comment", () => {
		expect(nextComment(comments, "a9", "previous")?.id).toBe("a3");
		expect(nextComment(comments, "a3", "previous")?.id).toBe("b1");
	});

	it("starts at the first or last comment when none is current", () => {
		expect(nextComment(comments, null, "next")?.id).toBe("a3");
		expect(nextComment(comments, null, "previous")?.id).toBe("b1");
		expect(nextComment(comments, "gone", "next")?.id).toBe("a3");
	});

	it("skips resolved comments unless every comment is resolved", () => {
		const mixed = [...comments, comment("r1", "a.ts", 5, { resolved: true })];
		expect(nextComment(mixed, "a3", "next")?.id).toBe("a9");
		expect(nextComment(mixed, "r1", "next")?.id).toBe("a9");
		expect(nextComment(mixed, "r1", "previous")?.id).toBe("a3");

		const allResolved = mixed.map((entry) => ({ ...entry, resolved: true }));
		expect(nextComment(allResolved, "a3", "next")?.id).toBe("r1");
	});

	it("answers null when there are no comments", () => {
		expect(nextComment([], null, "next")).toBeNull();
	});
});
