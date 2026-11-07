import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SuggestionPopup,
	type SuggestionRow,
	suggestionPopupPosition,
} from "./SuggestionPopup.tsx";

afterEach(cleanup);

const rows: SuggestionRow[] = [
	{ id: "one", label: "one.ts" },
	{ id: "two", label: "two.ts", detail: "Directory" },
	{ id: "three", label: "three.ts" },
];

describe("COMP-04 SuggestionPopup", () => {
	it("marks the second row selected when selectedIndex is 1", () => {
		render(
			<SuggestionPopup
				rows={rows}
				selectedIndex={1}
				state="ready"
				emptyText="No files found"
				onPick={() => {}}
			/>,
		);
		const options = screen.getAllByRole("option");
		expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual([
			"false",
			"true",
			"false",
		]);
	});

	it("calls onPick with the clicked row", () => {
		const onPick = vi.fn();
		render(
			<SuggestionPopup
				rows={rows}
				selectedIndex={0}
				state="ready"
				emptyText="No files found"
				onPick={onPick}
			/>,
		);
		fireEvent.click(screen.getByRole("option", { name: /two\.ts/ }));
		expect(onPick).toHaveBeenCalledWith(rows[1]);
	});

	it("shows a loading row while the list is loading", () => {
		render(
			<SuggestionPopup
				rows={[]}
				selectedIndex={0}
				state="loading"
				emptyText="No files found"
				onPick={() => {}}
			/>,
		);
		expect(screen.getByRole("listbox").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("status").textContent).toBe("Loading ...");
	});

	it("shows the caller's empty text when there are no rows", () => {
		render(
			<SuggestionPopup
				rows={[]}
				selectedIndex={0}
				state="ready"
				emptyText="No files found"
				onPick={() => {}}
			/>,
		);
		expect(screen.getByRole("status").textContent).toBe("No files found");
		expect(screen.queryAllByRole("option")).toHaveLength(0);
	});

	it("opens below the caret and flips above when there is no room below", () => {
		const anchor = { left: 40, top: 700, bottom: 720 };
		expect(suggestionPopupPosition(anchor, 220, 1_000)).toEqual({ left: 40, top: 720 });
		expect(suggestionPopupPosition(anchor, 220, 800)).toEqual({ left: 40, top: 480 });
	});
});
