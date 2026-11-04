/**
 * @feature CHAT-06 Assistant text
 * Owns: Rendering the assistant's Markdown: headings, lists, tables, links, code blocks, callouts
 * and images.
 * Behaviour: ui-map.md 3.3 (Assistant text: Markdown, Mermaid diagrams, callouts
 * Note/Tip/Important/Warning/Caution, code blocks with copy, images, video).
 * Our design choice: No Markdown library is installed yet. Needs an owner decision (for example
 * react-markdown with remark-gfm, MIT). Code blocks use shiki through CodeBlock. Mermaid and video
 * are later additions.
 * Must handle: Partial Markdown while streaming (an open code fence or list must not flash); very
 * long lines wrap; links open outside the app through the opener, never inside the window; raw HTML
 * is not rendered; an image that fails to load shows its alt text; text is selectable.
 * Test first: A text with an unclosed code fence renders as a code block without throwing.
 */
import { notImplemented } from "@conducted/shared";

export interface AssistantTextProps {
	text: string;
}

export function AssistantText(_props: AssistantTextProps): never {
	return notImplemented("CHAT-06");
}
