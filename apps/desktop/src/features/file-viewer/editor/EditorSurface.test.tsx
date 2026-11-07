/**
 * @feature REV-08 Editor surface
 * Tests that the CodeMirror view mounts, follows the text prop without calling it an edit, selects
 * the find match it is given, selects all text from the right-click menu, shows line numbers, and
 * is destroyed on unmount.
 */
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorSurfaceOptions } from "./codemirror-setup.ts";
import { EditorSurface } from "./EditorSurface.tsx";

/** The live CodeMirror view inside a rendered surface. */
function viewIn(container: HTMLElement): EditorView {
	const editor = container.querySelector<HTMLElement>(".cm-editor");
	const view = editor === null ? null : EditorView.findFromDOM(editor);
	if (view === null) throw new Error("No editor is mounted.");
	return view;
}

afterEach(cleanup);

const options: EditorSurfaceOptions = {
	wrapLines: true,
	ligatures: true,
	readOnly: false,
	fontFamily: "Geist Mono",
	themeType: "light",
};

describe("REV-08 EditorSurface", () => {
	it("mounts a CodeMirror view with the text and removes all of it on unmount", async () => {
		const { container, unmount } = render(
			<EditorSurface
				path="src/a.ts"
				text="const a = 1;"
				options={options}
				onChange={() => {}}
				onSave={() => {}}
			/>,
		);
		await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
		expect(container.querySelector(".cm-content")?.textContent).toContain("const a = 1;");
		unmount();
		expect(container.querySelector(".cm-editor")).toBeNull();
	});

	it("replaces the document when the text prop changes", async () => {
		const { container, rerender } = render(
			<EditorSurface
				path="src/a.ts"
				text="one"
				options={options}
				onChange={() => {}}
				onSave={() => {}}
			/>,
		);
		rerender(
			<EditorSurface
				path="src/a.ts"
				text="two"
				options={options}
				onChange={() => {}}
				onSave={() => {}}
			/>,
		);
		await waitFor(() =>
			expect(container.querySelector(".cm-content")?.textContent).toContain("two"),
		);
	});

	it("does not report a document it was given as the user's edit", async () => {
		const onChange = vi.fn();
		const { container, rerender } = render(
			<EditorSurface
				path="src/a.ts"
				text="one"
				options={options}
				onChange={onChange}
				onSave={() => {}}
			/>,
		);
		rerender(
			<EditorSurface
				path="src/a.ts"
				text="two from disk"
				options={options}
				onChange={onChange}
				onSave={() => {}}
			/>,
		);
		await waitFor(() => expect(viewIn(container).state.doc.toString()).toBe("two from disk"));
		expect(onChange).not.toHaveBeenCalled();

		const view = viewIn(container);
		act(() => {
			view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
		});
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith("two from disk!");
	});

	it("selects the match it is given", () => {
		const props = {
			path: "src/a.ts",
			text: "one two one",
			options,
			onChange: () => {},
			onSave: () => {},
		};
		const { container, rerender } = render(<EditorSurface {...props} selection={null} />);
		rerender(<EditorSurface {...props} selection={{ from: 8, to: 11 }} />);
		const main = viewIn(container).state.selection.main;
		expect({ from: main.from, to: main.to }).toEqual({ from: 8, to: 11 });
	});

	it("selects the whole document from the right-click menu", async () => {
		const { container } = render(
			<EditorSurface
				path="src/a.ts"
				text={"first line\nsecond line"}
				options={options}
				onChange={() => {}}
				onSave={() => {}}
			/>,
		);
		const host = container.querySelector("[data-editor-path]");
		expect(host).not.toBeNull();
		if (host !== null) fireEvent.contextMenu(host);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Select all text" }));
		const main = viewIn(container).state.selection.main;
		expect({ from: main.from, to: main.to }).toEqual({ from: 0, to: 22 });
	});

	it("shows a line number for each line", async () => {
		const { container } = render(
			<EditorSurface
				path="src/a.ts"
				text={"a\nb\nc"}
				options={options}
				onChange={() => {}}
				onSave={() => {}}
			/>,
		);
		await waitFor(() => expect(container.querySelector(".cm-lineNumbers")).not.toBeNull());
	});
});
