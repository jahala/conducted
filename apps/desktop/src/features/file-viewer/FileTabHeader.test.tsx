/**
 * @feature REV-08 File tab header
 * Tests the view toggles, the disabled reason, copy and the diff options. The text buttons Diff,
 * Preview and Edit became Conductor's icon toggles; their names stay, so the tests find them by name.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffPreferences } from "../diff/diff-types.ts";
import { FileTabHeader } from "./FileTabHeader.tsx";

afterEach(cleanup);

const preferences: DiffPreferences = {
	layout: "unified",
	hideWhitespaceChanges: false,
	wrapLines: true,
	ligatures: true,
};

const baseProps = {
	path: "src/a.ts",
	oldPath: null,
	mode: "diff",
	onModeChange: () => {},
	editDisabledReason: null,
	previewAvailable: true,
	rawAvailable: true,
	preferences,
	onPreferencesChange: () => {},
	dirty: false,
	saving: false,
	saveError: null,
	onSave: () => {},
	diffAvailable: true,
	copyText: "const a = 1;\n",
	onCopy: () => {},
	width: 900,
};

describe("REV-08 FileTabHeader", () => {
	// #534: a kind in Conductor's brand table draws its tinted glyph; the rest keep Material's image.
	it("shows the file's own glyph or Material icon in the path chip", () => {
		const view = render(
			<FileTabHeader {...baseProps} path="src/main.rs" mode="diff" onModeChange={() => {}} />,
		);
		const glyph = view.container.querySelector("svg[data-file-icon]");
		expect(glyph?.getAttribute("data-file-icon")).toBe("rust");
		expect(glyph?.getAttribute("class")).toContain("text-file-orange-700");

		view.rerender(
			<FileTabHeader {...baseProps} path="src/init.lua" mode="diff" onModeChange={() => {}} />,
		);
		const image = view.container.querySelector("img[data-file-icon]");
		expect(image?.getAttribute("data-file-icon")).toBe("lua");
		expect(image?.getAttribute("src")).toBeTruthy();
	});

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

	it("offers the diff layouts for a changed file and View options only with the diff", () => {
		const onModeChange = vi.fn();
		const { rerender } = render(
			<FileTabHeader {...baseProps} mode="diff" onModeChange={onModeChange} />,
		);
		expect(screen.getByRole("button", { name: "View options" })).toBeTruthy();
		rerender(<FileTabHeader {...baseProps} mode="edit" onModeChange={onModeChange} />);
		expect(screen.queryByRole("button", { name: "View options" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Unified view" }));
		expect(onModeChange).toHaveBeenCalledWith("diff");
		rerender(
			<FileTabHeader
				{...baseProps}
				diffAvailable={false}
				mode="edit"
				onModeChange={onModeChange}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Unified view" })).toBeNull();
	});

	it("follows Conductor's header: copy, then the toggles in one group, no text buttons", () => {
		const onCopy = vi.fn();
		render(<FileTabHeader {...baseProps} mode="edit" onModeChange={() => {}} onCopy={onCopy} />);
		const group = screen.getByRole("group", { name: "View" });
		expect(group.textContent).toBe("");
		expect(
			Array.from(group.querySelectorAll("button")).map((button) =>
				button.getAttribute("aria-label"),
			),
		).toEqual(["Unified view", "Split view", "Entire file", "Edit", "Preview"]);
		fireEvent.click(screen.getByRole("button", { name: "Copy file contents" }));
		expect(onCopy).toHaveBeenCalledWith("const a = 1;\n");
	});

	it("disables Copy file contents until the text is loaded", () => {
		render(<FileTabHeader {...baseProps} mode="edit" onModeChange={() => {}} copyText={null} />);
		expect(
			(screen.getByRole("button", { name: "Copy file contents" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("shows a Save button and the unsaved mark while there are edits", () => {
		const onSave = vi.fn();
		render(
			<FileTabHeader {...baseProps} mode="edit" onModeChange={() => {}} dirty onSave={onSave} />,
		);
		expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it("offers Conductor's read-only Entire file view for a text file", () => {
		const onModeChange = vi.fn();
		const { rerender } = render(
			<FileTabHeader {...baseProps} mode="diff" onModeChange={onModeChange} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Entire file" }));
		expect(onModeChange).toHaveBeenCalledWith("raw");

		rerender(
			<FileTabHeader {...baseProps} rawAvailable={false} mode="diff" onModeChange={onModeChange} />,
		);
		expect(screen.queryByRole("button", { name: "Entire file" })).toBeNull();
	});
});

describe("REV-08 FileTabHeader failed update", () => {
	it("shows Conductor's Retry update control after a failed save", () => {
		const onSave = vi.fn();
		render(<FileTabHeader {...baseProps} mode="edit" saveError="disk changed" onSave={onSave} />);
		const retry = screen.getByRole("button", { name: "Update failed. Retry" });
		expect(retry.textContent).toBe("Retry update");
		fireEvent.click(retry);
		expect(onSave).toHaveBeenCalledTimes(1);
	});
});
