/**
 * @feature PRJ-05 Repository icon
 * Owns: tests of where an uploaded icon is drawn on its square. The drawing itself needs a canvas,
 * which jsdom lacks; scripts/catalogue/icon-resize.browser.ts runs it in Chromium.
 * Test first: a 300 x 150 image is drawn at 128 x 64 in the middle of a 128 pixel square.
 */
import { describe, expect, it } from "vitest";
import { ICON_PIXELS, iconFit, MAX_ICON_SOURCE_PIXELS } from "./icon-image.ts";

describe("PRJ-05 iconFit", () => {
	it("shrinks a wide image to the icon's width and centres it on the square", () => {
		expect(iconFit(300, 150)).toEqual({
			ok: true,
			value: { size: ICON_PIXELS, x: 0, y: 32, width: 128, height: 64 },
		});
	});

	it("shrinks a tall image to the icon's height", () => {
		expect(iconFit(100, 400)).toEqual({
			ok: true,
			value: { size: 128, x: 48, y: 0, width: 32, height: 128 },
		});
	});

	it("never enlarges a small image: the square is its longer side", () => {
		expect(iconFit(64, 32)).toEqual({
			ok: true,
			value: { size: 64, x: 0, y: 16, width: 64, height: 32 },
		});
	});

	it("keeps at least one pixel on the short side", () => {
		const fit = iconFit(5000, 1);
		expect(fit.ok && fit.value.height).toBe(1);
	});

	it("draws an image with no size of its own, such as an SVG without one, at icon size", () => {
		expect(iconFit(0, 0)).toEqual({
			ok: true,
			value: { size: 128, x: 0, y: 0, width: 128, height: 128 },
		});
	});

	it("refuses an image over the pixel limit on either side", () => {
		expect(iconFit(MAX_ICON_SOURCE_PIXELS, 10).ok).toBe(true);
		const wide = iconFit(MAX_ICON_SOURCE_PIXELS + 1, 10);
		expect(wide.ok).toBe(false);
		if (!wide.ok) expect(wide.error.code).toBe("icon_image_too_large");
		expect(iconFit(10, MAX_ICON_SOURCE_PIXELS + 1).ok).toBe(false);
	});
});
