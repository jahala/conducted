/**
 * @feature APP-14 Theme variants
 * Owns: tests for the appearance attributes, the subscriber that applies them to <html>, and the
 * contrast guard that covers every theme and colour-vision combination.
 * Test first: dark, low-contrast dark, tritanopia and vibrancy together set all four attributes; a
 * change to the settings store changes document.documentElement; every text and mark pair, and all
 * sixteen terminal colours, meet their contrast threshold in every combination.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import {
	contrastOn,
	markPairs,
	parse,
	ratio,
	readPalette,
	type Theme,
	textPairs,
	tokenValue,
	type Vision,
} from "./contrast.ts";
import { HighlightedText } from "./HighlightedText.tsx";
import {
	applyThemeAttributes,
	applyThemeOnChange,
	type StoredThemeValues,
	type ThemeAttributeRoot,
	type ThemeVariantSettings,
	themeAttributes,
} from "./theme-variants.ts";

afterEach(cleanup);

const settings = (overrides: Partial<ThemeVariantSettings> = {}): ThemeVariantSettings => ({
	theme: "system",
	lowContrastDark: false,
	colorVision: "default",
	vibrancy: false,
	...overrides,
});

describe("APP-14 theme attributes", () => {
	it("combines dark, low contrast, a colour-vision choice and vibrancy", () => {
		expect(
			themeAttributes({
				theme: "dark",
				lowContrastDark: true,
				colorVision: "tritanopia",
				vibrancy: true,
			}),
		).toEqual({
			"data-theme": "dark",
			"data-contrast": "low",
			"data-color-vision": "tritanopia",
			"data-vibrancy": "on",
		});
	});

	it("leaves the theme to the system when the choice is system", () => {
		expect(themeAttributes(settings())).toEqual({});
	});

	it("forces only the theme that was chosen", () => {
		expect(themeAttributes(settings({ theme: "light" }))).toEqual({ "data-theme": "light" });
		expect(themeAttributes(settings({ theme: "dark" }))).toEqual({ "data-theme": "dark" });
	});

	it("sets low contrast only when the switch is on", () => {
		expect(themeAttributes(settings({ theme: "dark", lowContrastDark: true }))).toEqual({
			"data-theme": "dark",
			"data-contrast": "low",
		});
		expect(themeAttributes(settings({ theme: "dark", lowContrastDark: false }))).toEqual({
			"data-theme": "dark",
		});
	});

	it("sets a colour-vision palette only when one is chosen", () => {
		expect(themeAttributes(settings({ colorVision: "protanopia-deuteranopia" }))).toEqual({
			"data-color-vision": "protanopia-deuteranopia",
		});
		expect(themeAttributes(settings({ colorVision: "default" }))).toEqual({});
	});

	it("turns the translucent sidebar surface on only when vibrancy is on", () => {
		expect(themeAttributes(settings({ vibrancy: true }))).toEqual({ "data-vibrancy": "on" });
		expect(themeAttributes(settings({ vibrancy: false }))).toEqual({});
	});

	it("reports an unknown value and sets no attribute for it", () => {
		const reported: [string, unknown][] = [];
		const values = {
			theme: "sepia",
			lowContrastDark: "yes",
			colorVision: "achromatopsia",
			vibrancy: "on",
		} as StoredThemeValues;
		const attributes = themeAttributes(values, (key, value) => reported.push([key, value]));
		expect(attributes).toEqual({});
		expect(reported).toEqual([
			["theme", "sepia"],
			["lowContrastDark", "yes"],
			["colorVision", "achromatopsia"],
			["vibrancy", "on"],
		]);
	});

	it("sets and removes the attributes on the document element", () => {
		const attributes = new Map<string, string>();
		const root: ThemeAttributeRoot = {
			setAttribute: (name, value) => attributes.set(name, value),
			removeAttribute: (name) => attributes.delete(name),
		};
		applyThemeAttributes(
			root,
			settings({ theme: "dark", lowContrastDark: true, colorVision: "tritanopia", vibrancy: true }),
		);
		expect(attributes).toEqual(
			new Map([
				["data-theme", "dark"],
				["data-contrast", "low"],
				["data-color-vision", "tritanopia"],
				["data-vibrancy", "on"],
			]),
		);
		applyThemeAttributes(root, settings());
		expect(attributes.size).toBe(0);
	});
});

describe("APP-14 appearance wiring", () => {
	const ATTRIBUTES = ["data-theme", "data-contrast", "data-color-vision", "data-vibrancy"] as const;
	const clearAttributes = () => {
		for (const name of ATTRIBUTES) document.documentElement.removeAttribute(name);
	};

	afterEach(clearAttributes);

	it("writes setting changes to the document element until it is disposed", () => {
		clearAttributes();
		const store = createStore<ThemeVariantSettings>(() => settings());
		const dispose = applyThemeOnChange(document.documentElement, {
			read: () => store.getState(),
			subscribe: (listener) => store.subscribe(listener),
		});

		expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

		store.setState({
			theme: "dark",
			lowContrastDark: true,
			colorVision: "tritanopia",
			vibrancy: true,
		});
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
		expect(document.documentElement.getAttribute("data-contrast")).toBe("low");
		expect(document.documentElement.getAttribute("data-color-vision")).toBe("tritanopia");
		expect(document.documentElement.getAttribute("data-vibrancy")).toBe("on");

		store.setState(settings());
		expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

		dispose();
		store.setState({ theme: "light" });
		expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
	});
});

const CSS = readFileSync(join(import.meta.dirname, "..", "styles.css"), "utf8");
const palette = readPalette(CSS);
const colors = palette.colors;
const lowColors = palette.low;
const visionColors = palette.vision;

/** The sixteen ANSI slots draw text, so each meets 4.5:1 on the light and dark terminal backgrounds. */
const terminalColors = [
	"term-black",
	"term-red",
	"term-green",
	"term-yellow",
	"term-blue",
	"term-magenta",
	"term-cyan",
	"term-white",
	"term-bright-black",
	"term-bright-red",
	"term-bright-green",
	"term-bright-yellow",
	"term-bright-blue",
	"term-bright-magenta",
	"term-bright-cyan",
	"term-bright-white",
];

const themes: [Theme, string][] = [
	[0, "light"],
	[1, "dark"],
	[2, "low-contrast dark"],
];
const visions: [Vision, string][] = [
	["default", "default colours"],
	["protanopia-deuteranopia", "protanopia and deuteranopia"],
	["tritanopia", "tritanopia"],
];

describe("APP-14 contrast guard", () => {
	it("reads every token the guard relies on", () => {
		const names = new Set(
			[
				...textPairs,
				...markPairs,
				...terminalColors.map((name) => [name, "canvas"] as [string, string]),
			].flat(),
		);
		expect([...colors.keys()]).toEqual(expect.arrayContaining([...names]));
	});

	it("keeps Conductor's low-contrast dark replacements", () => {
		expect(lowColors.get("canvas")?.[1]).toBe("#1f1c1a");
		expect(lowColors.get("panel")?.[1]).toBe("#24211e");
		expect(lowColors.get("surface")?.[1]).toBe("#292623");
		expect(lowColors.get("raised")?.[1]).toBe("#37322f");
		expect(lowColors.get("muted")?.[1]).toBe("#2f2b28");
		expect(lowColors.get("fg")?.[1]).toBe("#c5c2be");
		expect(lowColors.get("highlight-surface")?.[1]).toBe("#3f3331");
		expect(lowColors.get("highlight-fg")?.[1]).toBe("#e3dad3");
	});

	it("changes only dark values in the low-contrast set", () => {
		expect(lowColors.size).toBeGreaterThan(0);
		for (const [name, [light]] of lowColors) {
			expect(colors.get(name)?.[0], `--color-${name}`).toBe(light);
		}
	});

	it("keeps warning distinguishable under every colour-vision variant", () => {
		expect(visionColors["protanopia-deuteranopia"].has("warning")).toBe(false);
		expect(visionColors.tritanopia.has("warning")).toBe(false);
	});

	it("turns success and added colours blue, and danger and removed colours orange", () => {
		for (const vision of ["protanopia-deuteranopia", "tritanopia"] as const) {
			expect(visionColors[vision].get("success")?.[0]).toBe("#2463eb");
			expect(visionColors[vision].get("git-added")?.[0]).toBe("#2463eb");
		}
		expect(visionColors["protanopia-deuteranopia"].get("danger")?.[0]).toBe("#b7430a");
		expect(visionColors["protanopia-deuteranopia"].get("danger-solid")?.[0]).toBe("#b7430a");
		expect(visionColors["protanopia-deuteranopia"].get("git-removed")?.[0]).toBe("#b7430a");
		expect(visionColors.tritanopia.has("danger")).toBe(false);
	});

	it("checks itself on known contrast cases", () => {
		expect(ratio(parse("#000000"), parse("#ffffff"))).toBeCloseTo(21, 1);
		expect(ratio(parse("#767676"), parse("#ffffff"))).toBeCloseTo(4.54, 2);
	});

	describe.each(themes.map(([theme, label]) => [label, theme] as const))(
		"APP-14 %s theme",
		(themeLabel, theme) => {
			describe.each(visions.map(([vision, label]) => [label, vision] as const))(
				"APP-14 %s vision",
				(visionLabel, vision) => {
					it.each(textPairs)(
						`text %s on %s meets 4.5:1 in ${themeLabel} with ${visionLabel}`,
						(fg, bg) => {
							expect(contrastOn(palette, fg, bg, theme, vision)).toBeGreaterThanOrEqual(4.5);
						},
					);

					it.each(markPairs)(
						`mark %s on %s meets 3:1 in ${themeLabel} with ${visionLabel}`,
						(fg, bg) => {
							expect(contrastOn(palette, fg, bg, theme, vision)).toBeGreaterThanOrEqual(3);
						},
					);

					it.each(terminalColors)(
						`terminal %s meets 4.5:1 on both terminal backgrounds in ${themeLabel} with ${visionLabel}`,
						(name) => {
							for (const background of ["canvas", "panel"]) {
								expect(contrastOn(palette, name, background, theme, vision)).toBeGreaterThanOrEqual(
									4.5,
								);
							}
						},
					);
				},
			);
		},
	);

	it("gives the sidebar a translucent surface for vibrancy", () => {
		expect(tokenValue(palette, "sidebar-translucent", 0)).toBe("#fafaf999");
		expect(tokenValue(palette, "sidebar-translucent", 1)).toBe("#211e1c99");
		expect(lowColors.get("sidebar-translucent")?.[1]).toBe("#29262399");
		expect(
			/:root\[data-vibrancy="on"\]\s*\{[^}]*--color-surface:\s*var\(--color-sidebar-translucent\)/s.test(
				CSS,
			),
		).toBe(true);
	});
});

describe("APP-14 search highlight", () => {
	it("marks matches with the dedicated search-highlight tokens", () => {
		const { container } = render(<HighlightedText text="Find me" query="me" />);
		const mark = container.querySelector("mark");
		expect(mark?.className).toContain("bg-search-highlight");
		expect(mark?.className).toContain("text-search-highlight-fg");
	});
});
