/**
 * @feature CHAT-06 Code block
 * Owns: A highlighted code block with a language label and a copy button.
 * Behaviour: ui-map.md 3.3 (code blocks with copy), 8 (Shiki for highlight; CodeBlockMemoized).
 * Our design choice: Highlighting runs through shiki, loaded on first use, and falls back to plain
 * monospace text while it loads. Themes follow the app's light or dark mode.
 * Must handle: Unknown language (plain text); a very large block (cut off with 'Show all');
 * streaming code (re-highlight without flicker, memoised on the text); copy confirms with a short
 * 'Copied' label; horizontal scroll, no wrapping.
 * Test first: Renders the code text for an unknown language and the copy button copies exactly that
 * text.
 */
import { notImplemented } from "@conducted/shared";

export interface CodeBlockProps {
	code: string;
	language: string | null;
}

export function CodeBlock(_props: CodeBlockProps): never {
	return notImplemented("CHAT-06");
}
