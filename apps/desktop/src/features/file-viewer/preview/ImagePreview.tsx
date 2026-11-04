/**
 * @feature REV-08 Image preview
 * Owns: showing a raster image from a file, fitted to the tab, with zoom.
 * Behaviour: ui-map.md 3.2 (previews; error text "Failed to load image" in 7.4).
 * Must handle: a huge image (downscaled by the browser, not decoded twice), a broken file (error
 * card), transparency (checkerboard background), the image changing on disk (reload without
 * flicker), and the original size shown in a caption.
 * Test first: an image URL that fails to load shows the error card with the file name.
 */
import { notImplemented } from "@conducted/shared";

export interface ImagePreviewProps {
	url: string;
	fileName: string;
}

export function ImagePreview(_props: ImagePreviewProps): never {
	return notImplemented("REV-08");
}
