/**
 * @feature REV-03 Comment card
 * Tests the author label and the actions each author kind gets.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffComment } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";
import { CommentCard } from "./CommentCard.tsx";

afterEach(cleanup);

const workspaceId = "ws-1" as WorkspaceId;

function comment(over: Partial<DiffComment> = {}): DiffComment {
	return {
		id: "c-1" as CommentId,
		workspaceId,
		filePath: "src/a.ts",
		line: 3,
		endLine: null,
		body: "Please rename this.",
		author: { kind: "user", name: null, avatarUrl: null },
		state: "pending",
		side: "additions",
		threadId: null,
		replyToId: null,
		suggestion: null,
		remoteUrl: null,
		resolved: false,
		outdated: false,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...over,
	};
}

const props = {
	editing: false,
	onStartEdit: () => {},
	onSaveEdit: () => {},
	onCancelEdit: () => {},
	onDelete: () => {},
};

describe("REV-03 CommentCard", () => {
	it("shows Edit and Delete for a comment by the user", () => {
		render(<CommentCard comment={comment()} {...props} />);

		expect(screen.getByText("You")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Edit comment" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Delete comment" })).toBeTruthy();
	});

	it("shows neither Edit nor Delete for a comment from GitHub", () => {
		render(
			<CommentCard
				comment={comment({ author: { kind: "github", name: "octocat", avatarUrl: null } })}
				{...props}
			/>,
		);

		expect(screen.getByText("octocat")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit comment" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Delete comment" })).toBeNull();
	});

	it("opens the editor when Edit is pressed", () => {
		const onStartEdit = vi.fn();
		render(<CommentCard comment={comment()} {...props} onStartEdit={onStartEdit} />);

		fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));

		expect(onStartEdit).toHaveBeenCalledTimes(1);
	});
});
