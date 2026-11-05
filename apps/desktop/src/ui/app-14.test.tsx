/**
 * @feature APP-14 Theme variants
 * Owns: tests for the appearance attributes and the contrast guard that covers every theme and
 * colour-vision combination.
 * Test first: dark, low-contrast dark and tritanopia together set all three attributes; every text and
 * mark pair, and all sixteen terminal colours, meet their contrast threshold in every combination.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HighlightedText } from "./HighlightedText.tsx";
import {
	applyThemeAttributes,
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
	...overrides,
});

describe("APP-14 theme attributes", () => {
	it("combines dark, low contrast and a colour-vision choice", () => {
		expect(
			themeAttributes({
				theme: "dark",
				lowContrastDark: true,
				colorVision: "tritanopia",
			}),
		).toEqual({
			"data-theme": "dark",
			"data-contrast": "low",
			"data-color-vision": "tritanopia",
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

	it("reports an unknown value and sets no attribute for it", () => {
		const reported: [string, unknown][] = [];
		const values = {
			theme: "sepia",
			lowContrastDark: "yes",
			colorVision: "achromatopsia",
		} as StoredThemeValues;
		const attributes = themeAttributes(values, (key, value) => reported.push([key, value]));
		expect(attributes).toEqual({});
		expect(reported).toEqual([
			["theme", "sepia"],
			["lowContrastDark", "yes"],
			["colorVision", "achromatopsia"],
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
			settings({ theme: "dark", lowContrastDark: true, colorVision: "tritanopia" }),
		);
		expect(attributes).toEqual(
			new Map([
				["data-theme", "dark"],
				["data-contrast", "low"],
				["data-color-vision", "tritanopia"],
			]),
		);
		applyThemeAttributes(root, settings());
		expect(attributes.size).toBe(0);
	});
});

type Pair = [light: string, dark: string];
type Rgba = [r: number, g: number, b: number, a: number];

const CSS = readFileSync(join(import.meta.dirname, "..", "styles.css"), "utf8");
const HEX = "#[0-9a-f]{6}(?:[0-9a-f]{2})?";
const PAIR = new RegExp(`^light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)$`, "i");
const SINGLE = new RegExp(`^${HEX}$`, "i");

function readColors(text: string): Map<string, Pair> {
	const colors = new Map<string, Pair>();
	for (const match of text.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
		const name = match[1];
		const value = match[2]?.trim();
		if (!name || !value || value === "initial") continue;
		const pair = PAIR.exec(value);
		if (pair?.[1] && pair[2]) colors.set(name, [pair[1], pair[2]]);
		else if (SINGLE.test(value)) colors.set(name, [value, value]);
	}
	return colors;
}

function extractBlock(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? "";
}

const LOW_SELECTOR = ':root[data-contrast="low"]';
const PROTAN_SELECTOR = ':root[data-color-vision="protanopia-deuteranopia"]';
const TRITAN_SELECTOR = ':root[data-color-vision="tritanopia"]';

const lowBlock = extractBlock(LOW_SELECTOR);
const protanBlock = extractBlock(PROTAN_SELECTOR);
const tritanBlock = extractBlock(TRITAN_SELECTOR);
let mainCss = CSS;
for (const content of [lowBlock, protanBlock, tritanBlock]) {
	if (content.length > 0) mainCss = mainCss.replace(content, "");
}

const colors = readColors(mainCss);
const lowColors = readColors(lowBlock);
const visionColors = {
	"protanopia-deuteranopia": readColors(protanBlock),
	tritanopia: readColors(tritanBlock),
} as const;

type Theme = 0 | 1 | 2;
type Vision = "default" | "protanopia-deuteranopia" | "tritanopia";

function parse(hex: string): Rgba {
	const n = Number.parseInt(hex.slice(1, 7), 16);
	const a = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

function over(top: Rgba, under: Rgba): Rgba {
	const [r, g, b, a] = top;
	return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
	const channel = (value: number) => {
		const s = value / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const value = (name: string, theme: Theme, vision: Vision): string => {
	const pair = colors.get(name);
	if (!pair) throw new Error(`token --color-${name} is missing`);
	let chosen = theme === 0 ? pair[0] : pair[1];
	if (theme === 2) {
		const low = lowColors.get(name);
		if (low) chosen = low[1];
	}
	if (vision !== "default") {
		const override = visionColors[vision].get(name);
		if (override) chosen = theme === 0 ? override[0] : override[1];
	}
	return chosen;
};

const translucentBases = ["canvas", "surface", "raised"];

function contrast(fg: string, bg: string, theme: Theme, vision: Vision): number {
	const back = parse(value(bg, theme, vision));
	const bases =
		back[3] < 1 ? translucentBases.map((name) => parse(value(name, theme, vision))) : [back];
	return Math.min(
		...bases.map((base) => {
			const ground = over(back, base);
			return ratio(over(parse(value(fg, theme, vision)), ground), ground);
		}),
	);
}

const surfaces = ["canvas", "panel", "surface", "muted", "raised", "hover", "active"];
const on = (fg: string, bgs: string[]): [string, string][] => bgs.map((bg) => [fg, bg]);

const textPairs: [string, string][] = [
	...on("fg", surfaces),
	...on("fg-muted", surfaces),
	...on("fg-subtle", surfaces),
	...on("sidebar-fg", ["surface", "hover"]),
	...on("sidebar-fg-muted", ["surface", "hover"]),
	["canvas", "primary-fill"],
	["on-check", "check"],
	["on-accent", "accent"],
	["on-accent", "accent-hover"],
	["on-danger", "danger-solid"],
	["warning-fg", "warning-surface"],
	["highlight-fg", "highlight-surface"],
	["search-highlight-fg", "search-highlight"],
	...on("link", ["canvas", "surface", "raised", "highlight-surface"]),
	...on("danger", ["canvas", "surface", "panel", "raised"]),
	...on("warning", ["canvas", "surface", "panel", "raised"]),
	...on("success", ["canvas", "surface", "panel", "raised"]),
	...on("git-added", ["canvas", "surface", "panel"]),
	...on("git-removed", ["canvas", "surface", "panel"]),
];

const markPairs: [string, string][] = [
	...on("focus", ["canvas", "surface", "panel", "raised"]),
	...on("border-strong", ["canvas", "surface", "panel", "raised"]),
	...on("accent", ["canvas", "surface", "panel"]),
	...on("unread", ["surface", "hover"]),
	...on("info", ["canvas", "surface"]),
	...on("check", ["canvas", "raised"]),
	...on("switch-on", ["canvas", "raised"]),
	...on("status-backlog", ["surface", "canvas", "hover"]),
	...on("status-progress", ["surface", "canvas", "hover"]),
	...on("status-review", ["surface", "canvas", "hover"]),
	...on("status-done", ["surface", "canvas", "hover"]),
	...on("status-canceled", ["surface", "canvas", "hover"]),
];

/** The sixteen ANSI slots are treated as marks (3:1), the same threshold as icons. The terminal's body
 * text is --color-fg, which the text pairs above check at 4.5:1. */
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
							expect(contrast(fg, bg, theme, vision)).toBeGreaterThanOrEqual(4.5);
						},
					);

					it.each(markPairs)(
						`mark %s on %s meets 3:1 in ${themeLabel} with ${visionLabel}`,
						(fg, bg) => {
							expect(contrast(fg, bg, theme, vision)).toBeGreaterThanOrEqual(3);
						},
					);

					it.each(terminalColors)(
						`terminal %s meets 3:1 on both terminal backgrounds in ${themeLabel} with ${visionLabel}`,
						(name) => {
							for (const background of ["canvas", "panel"]) {
								expect(contrast(name, background, theme, vision)).toBeGreaterThanOrEqual(3);
							}
						},
					);
				},
			);
		},
	);

	it("gives the sidebar a translucent surface for vibrancy", () => {
		expect(colors.get("sidebar-translucent")?.[0]).toBe("#fafaf999");
		expect(colors.get("sidebar-translucent")?.[1]).toBe("#211e1c99");
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
