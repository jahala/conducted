/**
 * @feature REV-08 Markdown preview
 * Owns: the rendered view of a Markdown file in the File tab.
 * Behaviour: ui-map.md 3.2 (previews) and 6 (Appearance: "Markdown Style", Default or Tufte).
 * Our design choice: the renderer must not run scripts or load remote images without a click, since
 * the file may come from an agent.
 * Must handle: relative links and images (resolved inside the workspace folder), fenced code with
 * syntax highlighting, tables, task lists, very large files (render progressively), an empty file,
 * and the style setting switching live.
 * Test first: a "<script>" tag in the text is not present in the rendered output.
 */
import { notImplemented } from "@conducted/shared";

export interface MarkdownPreviewProps {
	text: string;
	/** Folder of the file, for resolving relative links. */
	baseDir: string;
	style: "default" | "tufte";
	onOpenLink: (target: string) => void;
}

export function MarkdownPreview(_props: MarkdownPreviewProps): never {
	return notImplemented("REV-08");
}
