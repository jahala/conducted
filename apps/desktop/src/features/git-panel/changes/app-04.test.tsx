import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangesEmpty } from "./ChangesEmpty.tsx";

afterEach(cleanup);

describe("APP-04 ChangesEmpty", () => {
	it("clears the filter when no file matches it", () => {
		const onClearFilter = vi.fn();
		render(<ChangesEmpty reason="filter_no_match" onClearFilter={onClearFilter} />);
		fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
		expect(onClearFilter).toHaveBeenCalledTimes(1);
	});

	it("says changes appear here when nothing has changed", () => {
		render(<ChangesEmpty reason="no_changes" />);
		// Conductor's empty Changes tab: "No file changes yet", then "Changes appear here."
		expect(screen.getByRole("heading", { name: "No file changes yet" })).toBeTruthy();
	});

	it("asks the user to finish a rebase or merge first", () => {
		render(<ChangesEmpty reason="operation_in_progress" />);
		expect(screen.getByRole("heading", { name: "No git status" })).toBeTruthy();
		expect(screen.getByText("Finish rebasing or merging to see changes")).toBeTruthy();
	});

	it("keeps the list visible when only a note about untracked files is due", () => {
		render(
			<div>
				<p>changed file list</p>
				<ChangesEmpty reason="untracked_truncated" />
			</div>,
		);
		expect(screen.getByText("changed file list")).toBeTruthy();
		expect(screen.getByRole("note").textContent).toBe("Some untracked files are not shown.");
	});
});
