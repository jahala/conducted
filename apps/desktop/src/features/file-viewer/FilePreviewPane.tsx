/**
 * @feature REV-08 File preview pane
 * Owns: choosing the preview for a file and showing it. It uses classifyPreview and renders one of
 * the preview components.
 * Behaviour: ui-map.md 3.2 (previews for Markdown, SVG with "View raw SVG code" and "View rendered
 * SVG", images, PDF, CSV, video; "Preview unavailable").
 * Children: preview/MarkdownPreview, ImagePreview, SvgPreview, PdfPreview, CsvPreview,
 * VideoPreview, PreviewUnavailable.
 * Must handle: a preview that fails to load (error card with a way to see the raw file), a file
 * that changes on disk (preview reloads), and a type with no preview (shows the text editor or the
 * binary notice).
 * Test first: a path ending in ".md" renders the Markdown preview, and ".bin" renders the
 * unavailable notice.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface FilePreviewPaneProps {
	workspaceId: WorkspaceId;
	path: string;
}

export function FilePreviewPane(_props: FilePreviewPaneProps): never {
	return notImplemented("REV-08");
}
