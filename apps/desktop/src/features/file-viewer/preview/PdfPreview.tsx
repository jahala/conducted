/**
 * @feature REV-08 PDF preview
 * Owns: showing a PDF in the File tab.
 * Behaviour: ui-map.md 3.2 (previews include PDF; errors "Failed to load PDF", "Failed to render
 * page").
 * Our design choice: the webview's own PDF view is used through an object element, so there is no
 * extra renderer or licence. A load error shows the same error card as the other previews.
 * Must handle: a damaged PDF (error card with Retry), a long PDF (the webview scrolls its pages),
 * and the PDF changing on disk (the URL carries the modified time, so the object reloads and an
 * earlier failure clears).
 * Test first: a damaged PDF shows the error card, not a blank pane.
 */
import { useState } from "react";
import { PreviewUnavailable } from "./PreviewUnavailable.tsx";

export interface PdfPreviewProps {
	url: string;
	fileName: string;
}

export function PdfPreview({ url, fileName }: PdfPreviewProps) {
	// The failure belongs to one URL and one attempt: a new URL or Retry loads the PDF again.
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);

	if (failedUrl === url) {
		return (
			<PreviewUnavailable
				fileName={fileName}
				sizeBytes={null}
				reason="Failed to load PDF."
				onRetry={() => {
					setFailedUrl(null);
					setAttempt((value) => value + 1);
				}}
			/>
		);
	}

	return (
		<div className="h-full w-full bg-surface">
			<object
				key={`${url}#${attempt}`}
				data={url}
				type="application/pdf"
				aria-label={fileName}
				className="h-full w-full"
				onError={() => setFailedUrl(url)}
			/>
		</div>
	);
}
