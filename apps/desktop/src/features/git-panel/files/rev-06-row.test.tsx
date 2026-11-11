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

	it("chooses the Material Icon Theme's icon from the file type", () => {
		const view = render(<FileTreeRow {...row()} />);
		const icon = view.container.querySelector("img[data-file-icon]");
		expect(icon?.getAttribute("data-file-icon")).toBe("typescript");
		expect(icon?.getAttribute("src")).toBeTruthy();

		view.rerender(<FileTreeRow {...row({ name: "README.md", path: "README.md" })} />);
		expect(
			view.container.querySelector("img[data-file-icon]")?.getAttribute("data-file-icon"),
		).toBe("readme");
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
