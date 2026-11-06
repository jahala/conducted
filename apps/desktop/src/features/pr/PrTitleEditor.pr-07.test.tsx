/**
 * @feature PR-07 PR title editor
 * Owns: tests of the PR tab's title and its "Edit PR title" dialog.
 * Behaviour: ui-map.md 3.2 and 5.2.
 * Test first: editing the title and pressing Enter calls onSave with the new text once.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrTitleEditor } from "./PrTitleEditor.tsx";

afterEach(cleanup);

describe("PR-07 PrTitleEditor", () => {
	it("saves the new title once when Enter is pressed in the Edit PR title dialog", async () => {
		const onSave = vi.fn().mockResolvedValue(true);
		render(<PrTitleEditor title="Old title" editable onSave={onSave} />);

		fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
		expect(screen.getByRole("dialog", { name: "Edit PR title" })).toBeTruthy();
		const input = screen.getByRole("textbox", { name: "PR title" });
		fireEvent.change(input, { target: { value: "New title" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => expect(onSave).toHaveBeenCalledWith("New title"));
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(await screen.findByText("New title")).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("keeps the old title when the save fails, and closes the dialog", async () => {
		const onSave = vi.fn().mockResolvedValue(false);
		render(<PrTitleEditor title="Old title" editable onSave={onSave} />);

		fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
		fireEvent.change(screen.getByRole("textbox", { name: "PR title" }), {
			target: { value: "New title" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByText("Old title")).toBeTruthy();
		expect(screen.queryByText("New title")).toBeNull();
	});

	it("does not offer Save for an empty title, nor Edit title on a closed PR", () => {
		const { unmount } = render(<PrTitleEditor title="Old title" editable onSave={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
		fireEvent.change(screen.getByRole("textbox", { name: "PR title" }), {
			target: { value: "  " },
		});
		expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
		unmount();

		render(<PrTitleEditor title="Old title" editable={false} onSave={vi.fn()} />);
		expect(screen.queryByRole("button", { name: "Edit title" })).toBeNull();
	});
});
