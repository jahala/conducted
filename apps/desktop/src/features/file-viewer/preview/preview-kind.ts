/**
 * @feature REV-08 Preview kind
 * Owns: the pure decision of how a file is shown, from its path and whether it is binary.
 * Behaviour: ui-map.md 3.2 (previews for Markdown, SVG, images, PDF, CSV, video).
 * Must handle: upper-case extensions, a file with no extension, ".svg" (previewable and also text),
 * ".md" and ".markdown", ".csv" and ".tsv", a binary file with an unknown type ("binary"), and a
 * dotfile such as ".env" (text).
 * Test first: classifyPreview("a/B.PNG", true) is "image", and ("notes.md", false) is "markdown".
 */
import { extensionOf, isVideoPath } from "../../../core/media-files.ts";

export type PreviewKind =
	| "text"
	| "markdown"
	| "image"
	| "svg"
	| "pdf"
	| "csv"
	| "video"
	| "binary";

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"bmp",
	"tif",
	"tiff",
	"ico",
	"heic",
]);

/** Extensions that are never text, even when a file with that name happens to decode as UTF-8. */
const BINARY_EXTENSIONS = new Set([
	"bin",
	"exe",
	"dll",
	"dylib",
	"so",
	"o",
	"a",
	"zip",
	"tar",
	"gz",
	"bz2",
	"xz",
	"7z",
	"rar",
	"class",
	"jar",
	"wasm",
	"pyc",
	"woff",
	"woff2",
	"ttf",
	"otf",
]);

export function classifyPreview(path: string, isBinary: boolean): PreviewKind {
	const extension = extensionOf(path);
	if (IMAGE_EXTENSIONS.has(extension)) return "image";
	if (extension === "pdf") return "pdf";
	if (isVideoPath(path)) return "video";
	if (isBinary || BINARY_EXTENSIONS.has(extension)) return "binary";
	if (extension === "md" || extension === "markdown") return "markdown";
	if (extension === "svg") return "svg";
	if (extension === "csv" || extension === "tsv") return "csv";
	return "text";
}
