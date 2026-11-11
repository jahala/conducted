/**
 * @feature REV-08 Editor syntax highlighting
 * Owns: colouring the editor's text with Shiki, from the file's language and the user's code theme.
 * Behaviour: ui-map.md 3.2 and 8 (the editor and diffs follow the code theme), measured from
 * Conductor 0.92.1 (renderApp @4981146): token colours come from the chosen code theme and a scope
 * with no rule keeps the text colour.
 * Library reference: `codeToTokens` from "shiki" returns one token list per line, each token with a
 * colour and font-style bits; `StateField`, `StateEffect` and `Text` come from "@codemirror/state";
 * `Decoration`, `EditorView` and `ViewPlugin` from "@codemirror/view".
 * Must handle: an unknown file type (no highlight), a language Shiki cannot load (the plain text
 * stays), a document replaced from outside (the old decoration is mapped, then replaced), a very
 * long document (no highlight above the size limit), and a theme or mode change (the extensions
 * are reconfigured and the text is tokenized again).
 * Test first: a .rs document gets keyword-coloured token ranges, and an unknown type gets none.
 */
import { type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import type { ThemedToken } from "shiki";
import { type FileLanguage, fileLanguage } from "../../../ui/file-language.ts";
import { type CodeThemeMode, codeThemeFor } from "../../chat/code-theme.ts";

/** Above this many characters the editor keeps plain text, so typing never waits on Shiki. */
export const MAX_HIGHLIGHT_CHARS = 200_000;

const SHIKI_LANGUAGES: Readonly<Partial<Record<FileLanguage, string>>> = {
	typescript: "typescript",
	tsx: "tsx",
	javascript: "javascript",
	jsx: "jsx",
	rust: "rust",
	python: "python",
	go: "go",
	java: "java",
	ruby: "ruby",
	php: "php",
	swift: "swift",
	kotlin: "kotlin",
	c: "c",
	cpp: "cpp",
	csharp: "csharp",
	shell: "bash",
	html: "html",
	css: "css",
	sass: "scss",
	json: "json",
	yaml: "yaml",
	toml: "toml",
	markdown: "markdown",
};

/** The Shiki language id for a path, or null when the file has no code language. */
export function shikiLanguageFor(path: string): string | null {
	return SHIKI_LANGUAGES[fileLanguage(path)] ?? null;
}

const setTokens = StateEffect.define<DecorationSet>();

const tokensField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(decorations, transaction) {
		let next = decorations.map(transaction.changes);
		for (const effect of transaction.effects) {
			if (effect.is(setTokens)) next = effect.value;
		}
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

const marks = new Map<string, Decoration>();

function markFor(style: string): Decoration {
	const known = marks.get(style);
	if (known !== undefined) return known;
	const mark = Decoration.mark({ attributes: { style } });
	marks.set(style, mark);
	return mark;
}

/** A token's inline style, or null when it would say nothing different from the plain text. */
export function styleFor(token: ThemedToken): string | null {
	const parts: string[] = [];
	if (token.color !== undefined && token.color.length > 0) parts.push(`color:${token.color}`);
	const fontStyle = token.fontStyle ?? 0;
	if ((fontStyle & 1) === 1) parts.push("font-style:italic");
	if ((fontStyle & 2) === 2) parts.push("font-weight:700");
	return parts.length === 0 ? null : parts.join(";");
}

/** Decoration ranges for the token lines, clipped to the document's own lines. */
export function tokenDecorations(doc: Text, lines: readonly ThemedToken[][]): DecorationSet {
	const ranges = [];
	for (let index = 0; index < lines.length && index + 1 <= doc.lines; index += 1) {
		const line = doc.line(index + 1);
		let position = line.from;
		for (const token of lines[index] ?? []) {
			const length = token.content.length;
			if (length === 0) continue;
			const style = styleFor(token);
			if (style !== null && position + length <= line.to) {
				ranges.push(markFor(style).range(position, position + length));
			}
			position += length;
		}
	}
	return Decoration.set(ranges, true);
}

/** The extension that colours the editor with Shiki, or nothing for a language Shiki does not know. */
export function shikiHighlight(path: string, codeTheme: string, mode: CodeThemeMode): Extension {
	const language = shikiLanguageFor(path);
	if (language === null) return [];
	const theme = codeThemeFor(codeTheme, mode);

	const highlighter = ViewPlugin.fromClass(
		class {
			private generation = 0;
			private active = true;

			constructor(private readonly view: EditorView) {
				this.schedule();
			}

			update(update: ViewUpdate): void {
				if (update.docChanged) this.schedule();
			}

			destroy(): void {
				this.active = false;
				this.generation += 1;
			}

			private schedule(): void {
				const text = this.view.state.doc.toString();
				if (text.length > MAX_HIGHLIGHT_CHARS) {
					this.view.dispatch({ effects: setTokens.of(Decoration.none) });
					return;
				}
				const generation = ++this.generation;
				void import("shiki")
					.then(({ codeToTokens }) => codeToTokens(text, { lang: language as never, theme }))
					.then((rendered) => {
						if (!this.active || generation !== this.generation) return;
						this.view.dispatch({
							effects: setTokens.of(tokenDecorations(this.view.state.doc, rendered.tokens)),
						});
					})
					.catch(() => {
						// Shiki failed to load the language or run here: the plain text is still on screen.
					});
			}
		},
	);

	return [tokensField, highlighter];
}
