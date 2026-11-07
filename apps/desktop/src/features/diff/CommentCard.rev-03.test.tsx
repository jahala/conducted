/**
 * @feature REV-03 Comment card
 * Tests the author label, the actions each author kind gets, and a suggested change shown and
 * edited against the lines it replaces.
 */
import type { CommentId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffComment } from "../../core/model.ts";
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
		suggestionBaseCode: null,
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
	onSaveEdit: async () => true,
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

	it("keeps the editor open and says so when the edit is not saved", async () => {
		const onSaveEdit = vi.fn(async () => false);
		render(<CommentCard comment={comment()} {...props} editing onSaveEdit={onSaveEdit} />);

		fireEvent.change(screen.getByRole("textbox", { name: "Edit comment" }), {
			target: { value: "Please rename this to parse." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(onSaveEdit).toHaveBeenCalledWith("Please rename this to parse.", undefined),
		);
		expect(await screen.findByText("The comment could not be saved.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
	});

	it("shows a suggested change against the lines it replaces", () => {
		render(
			<CommentCard
				comment={comment({ suggestion: "const b = 2;", suggestionBaseCode: "let b = 2;" })}
				{...props}
			/>,
		);

		expect(screen.getByText("let b = 2;")).toBeTruthy();
		expect(screen.getByText("const b = 2;")).toBeTruthy();
	});

	it("edits the suggested change together with the text", async () => {
		const onSaveEdit = vi.fn(async () => true);
		render(
			<CommentCard
				comment={comment({ suggestion: "const b = 2;", suggestionBaseCode: "let b = 2;" })}
				{...props}
				editing
				onSaveEdit={onSaveEdit}
			/>,
		);

		expect(
			(screen.getByRole("checkbox", { name: "Suggest a change" }) as HTMLInputElement).checked,
		).toBe(true);
		fireEvent.change(screen.getByRole("textbox", { name: "Suggested code" }), {
			target: { value: "const b = 3;" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(onSaveEdit).toHaveBeenCalledWith("Please rename this.", {
				code: "const b = 3;",
				baseCode: "let b = 2;",
			}),
		);
	});
});
