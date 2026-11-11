/**
 * @feature COMP-01 Composer
 * Owns: The layout methods TipTap and ProseMirror read when the editor scrolls the caret into view,
 * and the contenteditable model jsdom leaves out.
 * Behaviour: test support only.
 * Must handle: importing this file twice is harmless; it never replaces a method jsdom has; a
 * file that runs without a DOM (node environment) has no Range or Text, so nothing here throws.
 * Test first: not applicable.
 *
 * jsdom has no layout: Range and text nodes have no getClientRects or getBoundingClientRect.
 * This file also loads dom-polyfills.ts (ResizeObserver, matchMedia, scrollTo, scrollIntoView), so no test has to
 * import it by hand.
 */
import "./dom-polyfills.ts";

const zeroRect = (): DOMRect => ({
	bottom: 0,
	height: 0,
	left: 0,
	right: 0,
	top: 0,
	width: 0,
	x: 0,
	y: 0,
	toJSON: () => ({}),
});

const zeroRectList = (): DOMRectList => {
	const rects: DOMRect[] = [];
	return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
};

if (typeof Range !== "undefined") {
	const range = Range.prototype;
	if (typeof range.getClientRects !== "function") {
		range.getClientRects = zeroRectList;
	}
	if (typeof range.getBoundingClientRect !== "function") {
		range.getBoundingClientRect = zeroRect;
	}
}

// jsdom has no contenteditable model: it never defines `isContentEditable`, which the browser menu
// guard reads (APP-01) and any editor test may. Read it from the nearest element that sets the
// attribute, as the DOM does: "true", "" and "plaintext-only" are editable, "false" is not.
if (typeof HTMLElement !== "undefined" && !("isContentEditable" in HTMLElement.prototype)) {
	const editable = new Set(["", "true", "plaintext-only"]);
	Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
		configurable: true,
		get(this: HTMLElement): boolean {
			const host = this.closest("[contenteditable]");
			if (!(host instanceof HTMLElement)) return false;
			return editable.has((host.getAttribute("contenteditable") ?? "").toLowerCase());
		},
	});
}

if (typeof Text !== "undefined") {
	const text = Text.prototype as unknown as {
		getClientRects?: () => DOMRectList;
		getBoundingClientRect?: () => DOMRect;
	};
	if (typeof text.getClientRects !== "function") {
		text.getClientRects = zeroRectList;
	}
	if (typeof text.getBoundingClientRect !== "function") {
		text.getBoundingClientRect = zeroRect;
	}
}
