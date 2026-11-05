import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { ArchivedNotice } from "./ArchivedNotice.tsx";

afterEach(cleanup);

describe("WS-06 ArchivedNotice", () => {
	it("renders Conductor's explanation and unarchives on request", () => {
		const onUnarchive = vi.fn();
		render(<ArchivedNotice onUnarchive={onUnarchive} busy={false} />);

		expect(screen.getByText("Workspace archived")).toBeTruthy();
		expect(
			screen.getByText("Unarchive this workspace to view files, terminals, and browser previews."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
		expect(onUnarchive).toHaveBeenCalledWith(null);
	});

	it("blocks a second unarchive while the first is running", () => {
		const onUnarchive = vi.fn();
		render(<ArchivedNotice onUnarchive={onUnarchive} busy />);

		const button = screen.getByRole("button", { name: "Unarchive" }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(onUnarchive).not.toHaveBeenCalled();
	});

	it("asks for a branch name when the old branch cannot be reused", () => {
		const onUnarchive = vi.fn();
		render(<ArchivedNotice onUnarchive={onUnarchive} busy={false} branchNameRequired />);

		const field = screen.getByRole("textbox", { name: "Branch name" });
		const button = screen.getByRole("button", { name: "Unarchive" }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.change(field, { target: { value: "feature/restored" } });
		fireEvent.click(button);
		expect(onUnarchive).toHaveBeenCalledWith("feature/restored");
	});

	it("shows the error for a branch name the service refused", () => {
		render(
			<ArchivedNotice
				onUnarchive={vi.fn()}
				busy={false}
				branchNameRequired
				branchError="That branch is checked out elsewhere."
			/>,
		);

		expect(screen.getByText("That branch is checked out elsewhere.")).toBeTruthy();
	});
});
