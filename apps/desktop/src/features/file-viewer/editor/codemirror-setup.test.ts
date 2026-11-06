/**
 * @feature REV-08 CodeMirror setup
 * Tests the state built for a file: its document and its read-only flag.
 */
import { describe, expect, it, vi } from "vitest";
import { createEditorState, type EditorSurfaceOptions } from "./codemirror-setup.ts";

const options: EditorSurfaceOptions = {
	wrapLines: true,
	ligatures: true,
	readOnly: false,
	fontFamily: "Geist Mono",
	themeType: "light",
};

const hooks = { onChange: vi.fn(), onSave: vi.fn() };

describe("REV-08 createEditorState", () => {
	it("gives a TypeScript path the input text and an editable state", () => {
		const state = createEditorState("src/a.ts", "const a = 1;", options, hooks);
		expect(state.doc.toString()).toBe("const a = 1;");
		expect(state.readOnly).toBe(false);
	});

	it("makes the state read-only when asked", () => {
		const state = createEditorState("big.json", "{}", { ...options, readOnly: true }, hooks);
		expect(state.readOnly).toBe(true);
	});

	it("treats an unknown extension as plain text", () => {
		const state = createEditorState("notes.unknown", "hello", options, hooks);
		expect(state.doc.toString()).toBe("hello");
	});
});
