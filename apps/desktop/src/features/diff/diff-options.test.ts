/**
 * @feature REV-02 Renderer options from preferences
 * Tests the mapping from diff preferences and the theme to the renderer's options.
 */
import { describe, expect, it } from "vitest";
import { toDiffOptions } from "./diff-options.ts";
import type { DiffPreferences } from "./diff-types.ts";

const preferences: DiffPreferences = {
	layout: "unified",
	entireFile: false,
	hideWhitespaceChanges: false,
	wrapLines: false,
	ligatures: true,
};

describe("REV-02 toDiffOptions", () => {
	it("maps split layout and wrapping", () => {
		const options = toDiffOptions(
			{ ...preferences, layout: "split", wrapLines: true },
			{ name: "pierre-dark", type: "dark" },
		);
		expect(options.diffStyle).toBe("split");
		expect(options.overflow).toBe("wrap");
	});

	it("maps unified layout and scrolling", () => {
		const options = toDiffOptions(preferences, { name: "pierre-light", type: "light" });
		expect(options.diffStyle).toBe("unified");
		expect(options.overflow).toBe("scroll");
	});

	it("maps the entire file and whitespace preferences", () => {
		const options = toDiffOptions(
			{ ...preferences, entireFile: true, hideWhitespaceChanges: true },
			{ name: "pierre-light", type: "light" },
		);
		expect(options.expandUnchanged).toBe(true);
		expect(options.parseDiffOptions?.ignoreWhitespace).toBe(true);
	});

	it("falls back to the renderer's matching default theme", () => {
		expect(toDiffOptions(preferences, { name: "", type: "dark" }).theme).toBe("pierre-dark");
		expect(toDiffOptions(preferences, { name: "default", type: "light" }).theme).toBe(
			"pierre-light",
		);
	});

	it("keeps a named theme", () => {
		expect(toDiffOptions(preferences, { name: "catppuccin-mocha", type: "dark" }).theme).toBe(
			"catppuccin-mocha",
		);
	});
});
