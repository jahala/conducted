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
		expect(screen.getByRole("heading", { name: "Changes appear here" })).toBeTruthy();
	});

	it("names the git operation that is holding changes back", () => {
		render(<ChangesEmpty reason="operation_in_progress" operation="rebase" />);
		expect(screen.getByRole("heading", { name: "Finish the rebase" })).toBeTruthy();
		expect(screen.getByText("Changes appear here once the rebase finishes.")).toBeTruthy();
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
