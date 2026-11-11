/**
 * @feature REV-08 CodeMirror setup
 * Tests the state built for a file: its document and its read-only flag.
 */
import { undo } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { createEditorState, type EditorSurfaceOptions } from "./codemirror-setup.ts";

const options: EditorSurfaceOptions = {
	wrapLines: true,
	ligatures: true,
	readOnly: false,
	fontFamily: "Geist Mono",
	themeType: "light",
	codeTheme: "default",
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

describe("REV-08 editor keys and history", () => {
	it("undoes the user's last change through the history extension", () => {
		const state = createEditorState("src/a.ts", "one", options, hooks);
		const changed = state.update({ changes: { from: 3, insert: " two" } }).state;
		let undone = "";
		const handled = undo({
			state: changed,
			dispatch: (transaction) => {
				undone = transaction.state.doc.toString();
			},
		});
		expect(handled).toBe(true);
		expect(undone).toBe("one");
	});

	it("carries the default editing keys and the undo keys", () => {
		const state = createEditorState("src/a.ts", "one", options, hooks);
		const bindings = state.facet(keymap).flat() as { key?: string; mac?: string }[];
		const keys = bindings.flatMap((binding) => binding.key ?? binding.mac ?? []);
		expect(keys).toContain("Mod-z");
		expect(keys).toContain("Mod-y");
		expect(keys).toContain("ArrowLeft");
		expect(keys).toContain("Backspace");
	});
});
