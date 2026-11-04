/**
 * @feature REV-08 Editor surface
 * Owns: the React host of one CodeMirror view. It creates the view in an effect, keeps it in sync
 * with props, and destroys it on unmount.
 * Behaviour: ui-map.md 3.2 and 8 (CodeMirror 6 for file editing; ligatures setting applies to
 * editors and diffs).
 * Library reference (checked in node_modules): `EditorView` from "@codemirror/view" and
 * `EditorState` from "@codemirror/state". Language support, history, search and keymaps are in
 * other CodeMirror packages that are not installed yet (see the report).
 * Must handle: the document being replaced from outside (disk reload) without losing the cursor
 * when possible, destroy on unmount with no leaked listeners, focus on open, read-only mode, and a
 * resize of the tab.
 * Test first: mounting then unmounting leaves no editor DOM and no listeners behind.
 */
import { notImplemented } from "@conducted/shared";
import type { EditorSurfaceOptions } from "./codemirror-setup.ts";

export interface EditorSurfaceProps {
	path: string;
	text: string;
	options: EditorSurfaceOptions;
	onChange: (text: string) => void;
	onSave: () => void;
}

export function EditorSurface(_props: EditorSurfaceProps): never {
	return notImplemented("REV-08");
}
