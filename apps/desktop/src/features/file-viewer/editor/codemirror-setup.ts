/**
 * @feature REV-08 CodeMirror setup
 * Owns: building the CodeMirror state for a file: document, read-only, line wrapping, ligatures,
 * line numbers, the active line, a drawn selection (so a find match shows while the find bar has
 * focus), theme from app tokens, and the change and save hooks. A function from options to a
 * state, with no DOM access of its own.
 * Behaviour: ui-map.md 3.2 and 6 (Appearance: mono font, code ligatures, code theme).
 * Library reference: `EditorState`, `Annotation` from "@codemirror/state" and `EditorView`,
 * `keymap`, `lineNumbers`, `drawSelection`, `highlightActiveLine` from "@codemirror/view".
 * Language packages and "@codemirror/commands" are not installed, so every file is plain text and
 * the editor has no undo history and no default key map yet.
 * Must handle: an unknown file type (plain text), a very long line (wrapping on), a large file
 * (read-only above a size limit, Our design choice), CRLF files, a document replaced from outside
 * (marked with `externalChange`, so it never reads as the user's edit), and the user's theme
 * changing while the editor is open (the view reconfigures, it is not recreated).
 * Test first: a ".ts" path gives a state whose document equals the input text and is not read-only.
 */
import { Annotation, EditorState, type Extension } from "@codemirror/state";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view";

export interface EditorSurfaceOptions {
	wrapLines: boolean;
	ligatures: boolean;
	readOnly: boolean;
	fontFamily: string | null;
	themeType: "light" | "dark";
}

export interface EditorHooks {
	onChange: (text: string) => void;
	onSave: () => void;
}

/**
 * Marks a transaction that replaces the document from outside, such as a disk reload or a discard.
 * The change hook skips it, so only the user's own typing makes a file dirty.
 */
export const externalChange = Annotation.define<boolean>();

/** The editor's colour and font rules come from the app's design tokens. */
function editorTheme(options: EditorSurfaceOptions): Extension {
	const font = options.fontFamily ?? "var(--font-mono)";
	return EditorView.theme(
		{
			"&": {
				color: "var(--color-fg)",
				backgroundColor: "var(--color-canvas)",
				height: "100%",
				fontSize: "var(--text-code)",
				fontFamily: font,
				fontVariantLigatures: options.ligatures ? "normal" : "none",
			},
			".cm-content": { caretColor: "var(--color-fg)", padding: "8px 0" },
			".cm-gutters": {
				backgroundColor: "var(--color-surface)",
				color: "var(--color-fg-muted)",
				border: "none",
			},
			".cm-activeLine": { backgroundColor: "var(--color-hover)" },
			".cm-activeLineGutter": { backgroundColor: "var(--color-hover)" },
			".cm-selectionBackground, ::selection": { backgroundColor: "var(--color-active)" },
			"&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--color-active)" },
			".cm-scroller": { overflow: "auto", fontFamily: font },
			".cm-cursor": { borderLeftColor: "var(--color-fg)" },
		},
		{ dark: options.themeType === "dark" },
	);
}

/** The keyboard rules the editor owns: save, and the browser's usual editing gestures. */
function editorKeymap(hooks: EditorHooks): Extension {
	return keymap.of([
		{
			key: "Mod-s",
			preventDefault: true,
			run: () => {
				hooks.onSave();
				return true;
			},
		},
	]);
}

export function editorExtensions(
	_path: string,
	options: EditorSurfaceOptions,
	hooks: EditorHooks,
): Extension {
	const extensions: Extension[] = [
		EditorState.readOnly.of(options.readOnly),
		EditorView.editable.of(!options.readOnly),
		editorTheme(options),
		editorKeymap(hooks),
		lineNumbers(),
		highlightActiveLineGutter(),
		highlightActiveLine(),
		drawSelection(),
		EditorView.updateListener.of((update) => {
			if (!update.docChanged) return;
			if (update.transactions.some((tr) => tr.annotation(externalChange) === true)) return;
			hooks.onChange(update.state.doc.toString());
		}),
	];
	if (options.wrapLines) extensions.push(EditorView.lineWrapping);
	return extensions;
}

export function createEditorState(
	path: string,
	text: string,
	options: EditorSurfaceOptions,
	hooks: EditorHooks,
): EditorState {
	return EditorState.create({
		doc: text,
		extensions: [editorExtensions(path, options, hooks)],
	});
}
