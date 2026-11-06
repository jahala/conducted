/**
 * @feature REV-03 Comment thread
 * Tests the order of a thread and its collapsed resolved state.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffComment } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";
import { CommentThread } from "./CommentThread.tsx";
import type { CommentHandlers } from "./diff-types.ts";

afterEach(cleanup);

const workspaceId = "ws-1" as WorkspaceId;

function comment(id: string, body: string, createdAt: number, over: Partial<DiffComment> = {}) {
	return {
		id: id as CommentId,
		workspaceId,
		filePath: "src/a.ts",
		line: 7,
		endLine: null,
		body,
		author: { kind: "user", name: null, avatarUrl: null },
		state: "pending",
		side: "additions",
		threadId: "t-1",
		replyToId: null,
		suggestion: null,
		remoteUrl: null,
		resolved: false,
		outdated: false,
		createdAt,
		updatedAt: createdAt,
		...over,
	} satisfies DiffComment;
}

const handlers: CommentHandlers = {
	onAdd: vi.fn(async () => true),
	onEdit: vi.fn(async () => true),
	onDelete: vi.fn(async () => true),
	onSetResolved: vi.fn(async () => true),
	onSendToChat: vi.fn(),
};

describe("REV-03 CommentThread", () => {
	it("renders a root and two replies as three cards in time order", () => {
		render(
			<CommentThread
				comments={[
					comment("c-3", "third", 3000),
					comment("c-1", "first", 1000),
					comment("c-2", "second", 2000),
				]}
				handlers={handlers}
			/>,
		);

		const cards = screen.getAllByTestId("comment-card");
		expect(cards).toHaveLength(3);
		expect(cards.map((card) => card.textContent ?? "")).toEqual([
			expect.stringContaining("first"),
			expect.stringContaining("second"),
			expect.stringContaining("third"),
		]);
	});

	it("collapses a resolved thread to its root until it is expanded", () => {
		render(
			<CommentThread
				comments={[
					comment("c-1", "first", 1000, { resolved: true }),
					comment("c-2", "second", 2000),
				]}
				handlers={handlers}
			/>,
		);

		expect(screen.getAllByTestId("comment-card")).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Expand thread" }));
		expect(screen.getAllByTestId("comment-card")).toHaveLength(2);
	});

	it("resolves every comment of the thread, replies included", async () => {
		const onSetResolved = vi.fn(async () => true);
		render(
			<CommentThread
				comments={[comment("c-1", "first", 1000), comment("c-2", "second", 2000)]}
				handlers={{ ...handlers, onSetResolved }}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

		await waitFor(() => expect(onSetResolved).toHaveBeenCalledTimes(2));
		expect(onSetResolved).toHaveBeenNthCalledWith(1, "c-1", true);
		expect(onSetResolved).toHaveBeenNthCalledWith(2, "c-2", true);
	});
});
