/**
 * @feature REV-08 PDF preview
 * Owns: showing a PDF in the File tab.
 * Behaviour: ui-map.md 3.2 (previews include PDF; errors "Failed to load PDF", "Failed to render
 * page").
 * Open question: which renderer to use is not decided (WKWebView shows PDFs in an embedded
 * element; a JavaScript renderer is another route). Decide before the build and check the licence.
 * Must handle: an encrypted or damaged PDF (error card), a long PDF (pages render as they scroll),
 * and the PDF changing on disk.
 * Test first: a damaged PDF shows the error card, not a blank pane.
 */
import { notImplemented } from "@conducted/shared";

export interface PdfPreviewProps {
	url: string;
	fileName: string;
}

export function PdfPreview(_props: PdfPreviewProps): never {
	return notImplemented("REV-08");
}
