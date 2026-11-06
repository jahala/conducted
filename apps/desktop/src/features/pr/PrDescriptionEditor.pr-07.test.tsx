import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrDescriptionEditor } from "./PrDescriptionEditor.tsx";

afterEach(cleanup);

describe("PR-07 PrDescriptionEditor", () => {
	it("shows the No description placeholder and enters edit mode when clicked", () => {
		render(<PrDescriptionEditor body="" editable onSave={vi.fn().mockResolvedValue(true)} />);

		const placeholder = screen.getByRole("button", { name: "Edit PR description" });
		expect(placeholder.textContent).toBe("No description");

		fireEvent.click(placeholder);
		expect(screen.getByRole("textbox", { name: "PR description" })).toBeTruthy();
	});

	it("shows a read-only No description for a closed pull request", () => {
		render(<PrDescriptionEditor body="" editable={false} onSave={vi.fn()} />);

		expect(screen.getByText("No description")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit PR description" })).toBeNull();
	});
});
