/**
 * @feature REV-08 Video preview
 * Owns: playing a video file in the File tab with native controls.
 * Behaviour: ui-map.md 3.2 (previews include video; error text "Failed to load video").
 * Must handle: a codec the webview cannot play (error card with "Open in another app"), no
 * autoplay, and a file that is still being written.
 * Test first: a load error shows the error card with an Open in another app action.
 */
import { notImplemented } from "@conducted/shared";

export interface VideoPreviewProps {
	url: string;
	fileName: string;
	onOpenExternally: () => void;
}

export function VideoPreview(_props: VideoPreviewProps): never {
	return notImplemented("REV-08");
}
