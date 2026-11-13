/**
 * @feature PRJ-05 Repository icon
 * Owns: drawing an uploaded repository icon at icon size in the web view's canvas, and the rule
 * for where the image sits on its square.
 * Behaviour: Conductor's upload (renderApp `UWa` @11289680, "Conductor resizes it to icon size"):
 * the image is decoded by the web view, refused when a side is over 10,000 pixels, shrunk to fit a
 * square whose side is the longer side of the image but at most 128 pixels, centred on it with high
 * quality smoothing, and kept as a PNG. An image with no size of its own is drawn at 128.
 * Must handle: a wide or a tall image (centred, the rest left clear), a small one (never
 * enlarged), a very thin one (at least one pixel), bytes the web view cannot decode, and a web view
 * with no canvas (each an Err, never a blank icon).
 * Test first: a 300 x 150 image is drawn at 128 x 64 in the middle of a 128 pixel square.
 */
import { err, ok, type Result } from "@conducted/shared";
import { platformError } from "./platform.ts";

/** The longest side of a drawn icon, in pixels. */
export const ICON_PIXELS = 128;
/** The longest side an uploaded image may have before it is decoded onto a canvas. */
export const MAX_ICON_SOURCE_PIXELS = 10_000;

/** Where an image is drawn on its icon square: the square's side, then the image's box on it. */
export interface IconFit {
	size: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Where an image of this size sits on its icon square. A size of 0 means the image has none. */
export function iconFit(naturalWidth: number, naturalHeight: number): Result<IconFit> {
	const width = naturalWidth > 0 ? naturalWidth : ICON_PIXELS;
	const height = naturalHeight > 0 ? naturalHeight : ICON_PIXELS;
	if (width > MAX_ICON_SOURCE_PIXELS || height > MAX_ICON_SOURCE_PIXELS) {
		return err(
			platformError(
				"icon_image_too_large",
				`The image is ${width} x ${height} pixels, over the ${MAX_ICON_SOURCE_PIXELS} pixel limit.`,
			),
		);
	}
	const longer = Math.max(width, height);
	const size = Math.min(ICON_PIXELS, longer);
	const scale = size / longer;
	const drawnWidth = Math.max(1, Math.round(width * scale));
	const drawnHeight = Math.max(1, Math.round(height * scale));
	return ok({
		size,
		x: (size - drawnWidth) / 2,
		y: (size - drawnHeight) / 2,
		width: drawnWidth,
		height: drawnHeight,
	});
}

const failed = (message: string, cause?: unknown) =>
	err(platformError("icon_image_failed", message, cause));

/** Decodes an image the way an `<img>` does, which is the one decoder that reads SVG too. */
function decode(url: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => resolve(null);
		image.src = url;
	});
}

/** Draws `bytes` of type `mimeType` on its icon square and returns the PNG's bytes. */
export async function drawIconPng(
	bytes: Uint8Array,
	mimeType: string,
): Promise<Result<Uint8Array>> {
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (context === null) return failed("The web view has no 2D canvas to draw the icon on.");
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	const url = URL.createObjectURL(new Blob([copy.buffer], { type: mimeType }));
	try {
		const image = await decode(url);
		if (image === null) return failed("The web view could not decode the image.");
		const fit = iconFit(image.naturalWidth, image.naturalHeight);
		if (!fit.ok) return fit;
		const { size, x, y, width, height } = fit.value;
		canvas.width = size;
		canvas.height = size;
		// A new size resets the canvas's drawing state, so the smoothing is set after it.
		context.imageSmoothingQuality = "high";
		context.drawImage(image, x, y, width, height);
		const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		if (png === null) return failed("The web view could not encode the icon as PNG.");
		return ok(new Uint8Array(await png.arrayBuffer()));
	} catch (cause) {
		return failed("The web view could not draw the icon.", cause);
	} finally {
		URL.revokeObjectURL(url);
	}
}
