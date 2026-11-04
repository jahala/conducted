/**
 * @feature REV-08 Preview kind
 * Owns: the pure decision of how a file is shown, from its path and whether it is binary.
 * Behaviour: ui-map.md 3.2 (previews for Markdown, SVG, images, PDF, CSV, video).
 * Must handle: upper-case extensions, a file with no extension, ".svg" (previewable and also text),
 * ".md" and ".markdown", ".csv" and ".tsv", a binary file with an unknown type ("binary"), and a
 * dotfile such as ".env" (text).
 * Test first: classifyPreview("a/B.PNG", true) is "image", and ("notes.md", false) is "markdown".
 */
import { notImplemented } from "@conducted/shared";

export type PreviewKind =
	| "text"
	| "markdown"
	| "image"
	| "svg"
	| "pdf"
	| "csv"
	| "video"
	| "binary";

export function classifyPreview(_path: string, _isBinary: boolean): PreviewKind {
	return notImplemented("REV-08");
}
