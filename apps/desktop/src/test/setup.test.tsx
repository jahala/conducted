import { describe, expect, it } from "vitest";

// This file imports no polyfill: everything below must come from the setup file.
describe("test setup", () => {
	it("gives jsdom the layout methods editors read", () => {
		const range = document.createRange();
		expect(range.getClientRects().length).toBe(0);
		expect(range.getBoundingClientRect().width).toBe(0);
		const text = document.createTextNode("x");
		expect(typeof (text as unknown as { getClientRects: unknown }).getClientRects).toBe("function");
	});

	it("gives jsdom the browser APIs panels and toasts read when they mount", () => {
		expect(typeof ResizeObserver).toBe("function");
		expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
		expect(() => window.scrollTo(0, 0)).not.toThrow();
	});
});
