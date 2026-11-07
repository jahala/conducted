/**
 * @feature REV-03 Comment composer
 * Tests submitting, the empty state, and the discard prompt.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentComposer } from "./CommentComposer.tsx";

afterEach(cleanup);

const baseProps = {
	mode: "new" as const,
	initialBody: "",
	suggestionBase: null,
	onCancel: () => {},
};

describe("REV-03 CommentComposer", () => {
	it("asks before discarding text, and Keep editing leaves the text intact", () => {
		render(<CommentComposer {...baseProps} onSubmit={async () => true} />);
		const field = screen.getByLabelText("Add a comment for the AI");
		fireEvent.change(field, { target: { value: "Keep this text" } });
		fireEvent.keyDown(field, { key: "Escape" });

		expect(screen.getByText("Discard comment?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

		expect((field as HTMLTextAreaElement).value).toBe("Keep this text");
	});

	it("submits with Cmd+Enter and keeps the text when the save fails", async () => {
		const onSubmit = vi.fn(async () => false);
		render(<CommentComposer {...baseProps} onSubmit={onSubmit} />);
		const field = screen.getByLabelText("Add a comment for the AI");
		fireEvent.change(field, { target: { value: "A note" } });
		fireEvent.keyDown(field, { key: "Enter", metaKey: true });

		await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("A note", null));
		expect(await screen.findByText("The comment could not be saved.")).toBeTruthy();
		expect((field as HTMLTextAreaElement).value).toBe("A note");
	});

	it("keeps submit disabled for an empty body", () => {
		render(<CommentComposer {...baseProps} onSubmit={async () => true} />);

		const submit = screen.getByRole("button", { name: "Comment" }) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
	});

	it("sends the edited suggested code when the suggestion toggle is on", async () => {
		const onSubmit = vi.fn(async () => true);
		render(<CommentComposer {...baseProps} suggestionBase="const a = 1;" onSubmit={onSubmit} />);
		fireEvent.change(screen.getByLabelText("Add a comment for the AI"), {
			target: { value: "Use this instead" },
		});
		fireEvent.click(screen.getByRole("checkbox", { name: "Suggest a change" }));
		fireEvent.change(screen.getByLabelText("Suggested code"), {
			target: { value: "const a = 2;" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Comment" }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Use this instead", "const a = 2;"));
	});
});
