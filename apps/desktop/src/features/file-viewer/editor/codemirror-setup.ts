/**
 * @feature REV-08 CodeMirror setup
 * Owns: building the CodeMirror state for a file: language by file name, theme from app tokens,
 * line wrapping, ligatures, read-only, and the change and save hooks. A function from options to
 * a state, with no DOM access.
 * Behaviour: ui-map.md 3.2 and 6 (Appearance: mono font, code ligatures, code theme).
 * Library reference (checked in node_modules): `EditorState` from "@codemirror/state". The
 * extensions it needs (language, history, search, keymaps) come from packages that are not
 * installed yet.
 * Must handle: an unknown file type (plain text), a very long line (no freeze: wrapping on), a
 * large file (read-only above a size limit, Our design choice), CRLF files, and the user's theme
 * changing while the editor is open (a reconfigure, not a new editor).
 * Test first: a ".ts" path gives a state whose document equals the input text and is not read-only.
 */

import type { EditorState } from "@codemirror/state";
import { notImplemented } from "@conducted/shared";

export interface EditorSurfaceOptions {
	wrapLines: boolean;
	ligatures: boolean;
	readOnly: boolean;
	fontFamily: string | null;
	themeType: "light" | "dark";
}

export function createEditorState(
	_path: string,
	_text: string,
	_options: EditorSurfaceOptions,
	_hooks: { onChange: (text: string) => void; onSave: () => void },
): EditorState {
	return notImplemented("REV-08");
}
