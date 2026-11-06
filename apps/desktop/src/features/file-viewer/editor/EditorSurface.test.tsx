/**
 * @feature REV-08 Editor surface
 * Tests that the CodeMirror view mounts, follows the text prop, and is destroyed on unmount.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../../../test/dom-polyfills.ts";
import type { EditorSurfaceOptions } from "./codemirror-setup.ts";
import { EditorSurface } from "./EditorSurface.tsx";

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
});
