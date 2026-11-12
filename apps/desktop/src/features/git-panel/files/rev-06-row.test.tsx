import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTreeRow, type FileTreeRowProps } from "./FileTreeRow.tsx";

afterEach(cleanup);

const row = (over: Partial<FileTreeRowProps> = {}): FileTreeRowProps => ({
	name: "app.ts",
	path: "src/app.ts",
	depth: 1,
	isDirectory: false,
	expanded: false,
	selected: false,
	changed: false,
	onToggle: vi.fn(),
	onOpen: vi.fn(),
	...over,
});

describe("REV-06 file tree row", () => {
	it("shows the change marker for a changed file and hides it for an unchanged one", () => {
		const props = row({ changed: true });
		const view = render(<FileTreeRow {...props} />);
		expect(screen.getByRole("img", { name: "Changed" })).toBeTruthy();

		view.rerender(<FileTreeRow {...props} changed={false} />);
		expect(screen.queryByRole("img", { name: "Changed" })).toBeNull();
	});

	// #534: a kind in Conductor's brand table draws its tinted glyph; the rest keep Material's image.
	it("chooses Conductor's tinted glyph or the Material Icon Theme's icon from the file name", () => {
		const view = render(<FileTreeRow {...row()} />);
		const glyph = view.container.querySelector("svg[data-file-icon]");
		expect(glyph?.getAttribute("data-file-icon")).toBe("typescript");
		expect(glyph?.getAttribute("class")).toContain("text-file-blue-600");

		view.rerender(<FileTreeRow {...row({ name: "package.json", path: "web/package.json" })} />);
		expect(
			view.container.querySelector("svg[data-file-icon]")?.getAttribute("data-file-icon"),
		).toBe("nodejs");

		view.rerender(<FileTreeRow {...row({ name: "init.lua", path: "src/init.lua" })} />);
		const image = view.container.querySelector("img[data-file-icon]");
		expect(image?.getAttribute("data-file-icon")).toBe("lua");
		expect(image?.getAttribute("src")).toBeTruthy();
	});

	// Conductor opens a file on one click (renderApp @2530991); this test asserted double click.
	it("toggles a folder from its chevron once, toggles it from the row, and opens a file on one click", () => {
		const onToggle = vi.fn();
		const onOpen = vi.fn();
		const view = render(
			<FileTreeRow {...row({ name: "src", path: "src", isDirectory: true, onToggle, onOpen })} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Expand src" }));
		expect(onToggle).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("treeitem"));
		expect(onToggle).toHaveBeenCalledTimes(2);
		expect(onOpen).not.toHaveBeenCalled();

		view.rerender(<FileTreeRow {...row({ onToggle, onOpen })} />);
		fireEvent.click(screen.getByRole("treeitem"));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});
