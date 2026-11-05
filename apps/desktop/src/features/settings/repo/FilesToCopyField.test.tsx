import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { COPY_PREVIEW_LIMIT, FilesToCopyField, isOutsideRepository } from "./FilesToCopyField.tsx";

afterEach(cleanup);

describe("SET-07 FilesToCopyField", () => {
	it("refuses a pattern that reaches outside the repository", () => {
		const onChange = vi.fn();
		render(<FilesToCopyField patterns={[]} matches={null} source="settings" onChange={onChange} />);

		fireEvent.change(screen.getByLabelText("Add a file or pattern"), {
			target: { value: "../secret" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));

		expect(screen.getByText("Patterns must stay inside the repository.")).toBeTruthy();
		expect(onChange).not.toHaveBeenCalled();
		expect(isOutsideRepository("../secret")).toBe(true);
		expect(isOutsideRepository("config/../app.env")).toBe(true);
		expect(isOutsideRepository("!../secret")).toBe(true);
		expect(isOutsideRepository(".env*")).toBe(false);
	});

	it("adds an inside pattern and lists the saved patterns", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<FilesToCopyField patterns={[]} matches={null} source="settings" onChange={onChange} />,
		);

		fireEvent.change(screen.getByLabelText("Add a file or pattern"), {
			target: { value: ".env*" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));
		expect(onChange).toHaveBeenCalledWith([".env*"]);

		rerender(
			<FilesToCopyField
				patterns={[".env*"]}
				matches={null}
				source="settings"
				onChange={onChange}
			/>,
		);
		expect(
			within(screen.getByRole("list", { name: "Files to copy" })).getByText(".env*"),
		).toBeTruthy();
	});

	it("shows detection in progress", () => {
		render(
			<FilesToCopyField
				patterns={[".env*"]}
				matches={{ state: "detecting" }}
				source="settings"
				onChange={vi.fn()}
			/>,
		);

		expect(screen.getByText("Detecting files to copy...")).toBeTruthy();
	});

	it("shows the first 50 matches and reports the rest", () => {
		const paths = Array.from({ length: COPY_PREVIEW_LIMIT + 10 }, (_, index) => `.env.${index}`);
		render(
			<FilesToCopyField
				patterns={[".env*"]}
				matches={{ state: "ready", paths }}
				source="settings"
				onChange={vi.fn()}
			/>,
		);

		expect(screen.getByText("60 files will be copied")).toBeTruthy();
		expect(screen.getByText("10 more files are not shown.")).toBeTruthy();
		expect(
			within(screen.getByRole("list", { name: "Matching files" })).getAllByRole("listitem"),
		).toHaveLength(COPY_PREVIEW_LIMIT);
	});

	it("says when .worktreeinclude takes over and hides the editor", () => {
		render(
			<FilesToCopyField
				patterns={[".env"]}
				matches={null}
				source="worktreeinclude"
				onChange={vi.fn()}
			/>,
		);

		expect(screen.getByText(/Using \.worktreeinclude from this repository/)).toBeTruthy();
		expect(screen.queryByLabelText("Add a file or pattern")).toBeNull();
		expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
	});
});
