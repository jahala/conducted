/**
 * @feature REV-08 Image preview
 * Owns: showing a raster image from a file, fitted to the tab, with zoom.
 * Behaviour: ui-map.md 3.2 (previews; error text "Failed to load image" in 7.4).
 * Must handle: a huge image (downscaled by the browser), a broken file (error card), transparency
 * (checkerboard background), the image changing on disk (reload when the URL changes), and the
 * original size shown in a caption.
 * Test first: an image URL that fails to load shows the error card with the file name.
 */
import { useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { PreviewUnavailable } from "./PreviewUnavailable.tsx";

export interface ImagePreviewProps {
	url: string;
	fileName: string;
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export function ImagePreview({ url, fileName }: ImagePreviewProps) {
	const [zoom, setZoom] = useState(1);
	const [failed, setFailed] = useState(false);
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);

	if (failed) {
		return (
			<PreviewUnavailable fileName={fileName} sizeBytes={null} reason="Failed to load image." />
		);
	}

	const step = (direction: -1 | 1): void => {
		const index = ZOOM_STEPS.indexOf(zoom);
		const next = ZOOM_STEPS[Math.min(Math.max(index + direction, 0), ZOOM_STEPS.length - 1)];
		if (next !== undefined) setZoom(next);
	};

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex items-center justify-end gap-1 border-b border-border px-2 py-1">
				<Button variant="ghost" size="xs" onClick={() => step(-1)} disabled={zoom <= 0.25}>
					Zoom out
				</Button>
				<span className="min-w-12 text-center text-xs text-fg-muted">
					{Math.round(zoom * 100)}%
				</span>
				<Button variant="ghost" size="xs" onClick={() => step(1)} disabled={zoom >= 4}>
					Zoom in
				</Button>
			</div>
			<div
				className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
				style={{
					backgroundImage:
						"conic-gradient(var(--color-muted) 90deg, transparent 90deg 180deg, var(--color-muted) 180deg 270deg, transparent 270deg)",
					backgroundSize: "16px 16px",
				}}
			>
				<img
					src={url}
					alt={fileName}
					className="max-h-full max-w-full object-contain"
					style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
					onError={() => setFailed(true)}
					onLoad={(event) => {
						const image = event.currentTarget;
						setSize({ width: image.naturalWidth, height: image.naturalHeight });
					}}
				/>
			</div>
			<figure className="flex items-center justify-between border-t border-border px-3 py-1 text-xs text-fg-muted">
				<figcaption className="truncate">{fileName}</figcaption>
				{size === null ? null : (
					<span>
						{size.width} × {size.height}
					</span>
				)}
			</figure>
		</div>
	);
}
