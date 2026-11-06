/**
 * @feature REV-08 PDF preview
 * Owns: showing a PDF in the File tab.
 * Behaviour: ui-map.md 3.2 (previews include PDF; errors "Failed to load PDF", "Failed to render
 * page").
 * Our design choice: the webview's own PDF view is used through an object element, so there is no
 * extra renderer or licence. A load error shows the same error card as the other previews.
 * Must handle: a damaged PDF (error card), a long PDF (the webview scrolls its pages), and the PDF
 * changing on disk (the URL changes and the object reloads).
 * Test first: a damaged PDF shows the error card, not a blank pane.
 */
import { useState } from "react";
import { PreviewUnavailable } from "./PreviewUnavailable.tsx";

export interface PdfPreviewProps {
	url: string;
	fileName: string;
}

export function PdfPreview({ url, fileName }: PdfPreviewProps) {
	const [failed, setFailed] = useState(false);

	if (failed) {
		return <PreviewUnavailable fileName={fileName} sizeBytes={null} reason="Failed to load PDF." />;
	}

	return (
		<div className="h-full w-full bg-surface">
			<object
				data={url}
				type="application/pdf"
				aria-label={fileName}
				className="h-full w-full"
				onError={() => setFailed(true)}
			/>
		</div>
	);
}
