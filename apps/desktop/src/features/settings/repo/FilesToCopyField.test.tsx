import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY_PREVIEW_LIMIT, FilesToCopyField, isOutsideRepository } from "./FilesToCopyField.tsx";

afterEach(cleanup);

describe("SET-07 FilesToCopyField", () => {
	it("refuses a pattern that reaches outside the repository", () => {
		const onChange = vi.fn();
		render(<FilesToCopyField patterns={[]} matches={null} onChange={onChange} />);

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

	it("shows .worktreeinclude's patterns locked, with Conductor's note, when the repository has one", () => {
		render(
			<FilesToCopyField
				patterns={[".env*"]}
				worktreeInclude={["secret/", "config/*.local"]}
				matches={null}
				onChange={() => {}}
			/>,
		);

		expect(
			screen.getByText(
				"Using .worktreeinclude from this repository. Remove that file to edit these patterns here.",
			),
		).toBeTruthy();
		const field = screen.getByRole("textbox", { name: "Files to copy" }) as HTMLTextAreaElement;
		expect(field.value).toBe("secret/\nconfig/*.local");
		expect(field.readOnly).toBe(true);
		expect(screen.queryByLabelText("Add a file or pattern")).toBeNull();
	});

	it("adds an inside pattern and lists the saved patterns", () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<FilesToCopyField patterns={[]} matches={null} onChange={onChange} />,
		);

		fireEvent.change(screen.getByLabelText("Add a file or pattern"), {
			target: { value: ".env*" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));
		expect(onChange).toHaveBeenCalledWith([".env*"]);

		rerender(<FilesToCopyField patterns={[".env*"]} matches={null} onChange={onChange} />);
		expect(
			within(screen.getByRole("list", { name: "Files to copy" })).getByText(".env*"),
		).toBeTruthy();
	});

	it("shows detection in progress", () => {
		render(
			<FilesToCopyField patterns={[".env*"]} matches={{ state: "detecting" }} onChange={vi.fn()} />,
		);

		expect(screen.getByText("Detecting files to copy...")).toBeTruthy();
	});

	it("shows the first 50 matches and reports the rest", () => {
		const paths = Array.from({ length: COPY_PREVIEW_LIMIT + 10 }, (_, index) => `.env.${index}`);
		render(
			<FilesToCopyField
				patterns={[".env*"]}
				matches={{ state: "ready", paths }}
				onChange={vi.fn()}
			/>,
		);

		expect(screen.getByText("60 files will be copied")).toBeTruthy();
		expect(screen.getByText("10 more files are not shown.")).toBeTruthy();
		expect(
			within(screen.getByRole("list", { name: "Matching files" })).getAllByRole("listitem"),
		).toHaveLength(COPY_PREVIEW_LIMIT);
	});

	it("keeps the settings list editable when the repository has no .worktreeinclude", () => {
		const onChange = vi.fn();
		render(
			<FilesToCopyField
				patterns={[".env"]}
				worktreeInclude={null}
				matches={null}
				onChange={onChange}
			/>,
		);

		expect(screen.queryByText(/Using \.worktreeinclude/)).toBeNull();
		expect(screen.getByLabelText("Add a file or pattern")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Remove .env" }));
		expect(onChange).toHaveBeenCalledWith([]);
	});
});
