/**
 * @feature REV-08 File tab header
 * Tests the mode toggle, the disabled reason and the diff toolbar.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffPreferences } from "../diff/diff-types.ts";
import { FileTabHeader } from "./FileTabHeader.tsx";

afterEach(cleanup);

const preferences: DiffPreferences = {
	layout: "unified",
	entireFile: false,
	hideWhitespaceChanges: false,
	wrapLines: true,
	ligatures: true,
};

const baseProps = {
	path: "src/a.ts",
	oldPath: null,
	editDisabledReason: null,
	previewAvailable: true,
	preferences,
	onPreferencesChange: () => {},
	dirty: false,
	saving: false,
	saveError: null,
	onSave: () => {},
	width: 900,
};

describe("REV-08 FileTabHeader", () => {
	it("disables the Edit toggle for a deleted file and gives the reason", () => {
		render(
			<FileTabHeader
				{...baseProps}
				mode="diff"
				onModeChange={() => {}}
				editDisabledReason="This file was deleted, so there is nothing to edit."
			/>,
		);
		const edit = screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement;
		expect(edit.disabled).toBe(true);
		expect(edit.title).toContain("deleted");
	});

	it("switches modes through the buttons", () => {
		const onModeChange = vi.fn();
		render(<FileTabHeader {...baseProps} mode="diff" onModeChange={onModeChange} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		expect(onModeChange).toHaveBeenCalledWith("edit");
		fireEvent.click(screen.getByRole("button", { name: "Preview" }));
		expect(onModeChange).toHaveBeenCalledWith("preview");
	});

	it("shows the diff toolbar only in diff mode", () => {
		const { rerender } = render(
			<FileTabHeader {...baseProps} mode="diff" onModeChange={() => {}} />,
		);
		expect(screen.getByRole("button", { name: "Unified view" })).toBeTruthy();
		rerender(<FileTabHeader {...baseProps} mode="edit" onModeChange={() => {}} />);
		expect(screen.queryByRole("button", { name: "Unified view" })).toBeNull();
	});

	it("shows a Save button and the unsaved mark while there are edits", () => {
		const onSave = vi.fn();
		render(
			<FileTabHeader {...baseProps} mode="edit" onModeChange={() => {}} dirty onSave={onSave} />,
		);
		expect(screen.getByLabelText("Unsaved edits")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onSave).toHaveBeenCalledTimes(1);
	});
});
