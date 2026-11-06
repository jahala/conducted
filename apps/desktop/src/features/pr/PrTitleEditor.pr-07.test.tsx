import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrTitleEditor } from "./PrTitleEditor.tsx";

afterEach(cleanup);

describe("PR-07 PrTitleEditor", () => {
	it("saves the new title once when Enter is pressed", async () => {
		const onSave = vi.fn().mockResolvedValue(true);
		render(<PrTitleEditor title="Old title" editable onSave={onSave} />);

		fireEvent.click(screen.getByRole("button", { name: "Edit PR title" }));
		const input = screen.getByRole("textbox", { name: "PR title" });
		fireEvent.change(input, { target: { value: "New title" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => expect(onSave).toHaveBeenCalledWith("New title"));
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(await screen.findByText("New title")).toBeTruthy();
	});

	it("keeps the editor open and says so when the save fails", async () => {
		const onSave = vi.fn().mockResolvedValue(false);
		render(<PrTitleEditor title="Old title" editable onSave={onSave} />);

		fireEvent.click(screen.getByRole("button", { name: "Edit PR title" }));
		fireEvent.change(screen.getByRole("textbox", { name: "PR title" }), {
			target: { value: "New title" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Couldn't save the title.")).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "PR title" })).toBeTruthy();
	});
});
