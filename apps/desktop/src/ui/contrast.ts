/**
 * @feature APP-14 Theme variants
 * Owns: the WCAG contrast arithmetic and the token-pair matrix shared by the design-token tests.
 * Behaviour: ui-dimensions.md 9 (WCAG 2.x relative luminance, with translucent colours blended onto
 * their real background first) and 2 (the colour tokens).
 * Our design choice: the pair matrix lives here once, so the light/dark guard and the theme-variant
 * guard cannot drift apart.
 * Test first: tokens.test.ts and app-14.test.tsx both import it and check its arithmetic on known cases.
 */

export type Pair = [light: string, dark: string];
export type Rgba = [r: number, g: number, b: number, a: number];
/** 0 light, 1 dark, 2 low-contrast dark. */
export type Theme = 0 | 1 | 2;
export type Vision = "default" | "protanopia-deuteranopia" | "tritanopia";

const HEX = "#[0-9a-f]{6}(?:[0-9a-f]{2})?";
const PAIR = new RegExp(`^light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)$`, "i");
const SINGLE = new RegExp(`^${HEX}$`, "i");

/** `--color-x: light-dark(#aaa, #bbb);` gives both values; `--color-x: #aaa;` gives the same for both.
 * Values may carry an alpha byte (#rrggbbaa). Values that are not plain hex (color-mix) are skipped. */
export function readColors(text: string): Map<string, Pair> {
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

function extractBlock(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

export interface Palette {
	/** The base set, with every variant block removed. */
	colors: Map<string, Pair>;
	/** The low-contrast dark replacements. */
	low: Map<string, Pair>;
	/** The colour-vision palettes. */
	vision: Record<Exclude<Vision, "default">, Map<string, Pair>>;
}

const LOW = ':root[data-contrast="low"]';
const PROTAN = ':root[data-color-vision="protanopia-deuteranopia"]';
const TRITAN = ':root[data-color-vision="tritanopia"]';

/** Reads the base, low-contrast and colour-vision token blocks out of the stylesheet. */
export function readPalette(css: string): Palette {
	const low = readColors(extractBlock(css, LOW));
	const protan = readColors(extractBlock(css, PROTAN));
	const tritan = readColors(extractBlock(css, TRITAN));
	let main = css;
	for (const content of [
		extractBlock(css, LOW),
		extractBlock(css, PROTAN),
		extractBlock(css, TRITAN),
	]) {
		if (content.length > 0) main = main.replace(content, "");
	}
	return {
		colors: readColors(main),
		low,
		vision: { "protanopia-deuteranopia": protan, tritanopia: tritan },
	};
}

export function parse(hex: string): Rgba {
	const n = Number.parseInt(hex.slice(1, 7), 16);
	const a = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** Paints a colour that may be translucent over an opaque one. */
export function over(top: Rgba, under: Rgba): Rgba {
	const [r, g, b, a] = top;
	return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a), 1];
}

export function luminance([r, g, b]: Rgba): number {
	const channel = (value: number) => {
		const s = value / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function ratio(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** The value of a token in one theme and colour-vision combination. */
export function tokenValue(
	palette: Palette,
	name: string,
	theme: Theme,
	vision: Vision = "default",
): string {
	const pair = palette.colors.get(name);
	if (!pair) throw new Error(`token --color-${name} is missing`);
	let chosen = theme === 0 ? pair[0] : pair[1];
	if (theme === 2) {
		const low = palette.low.get(name);
		if (low) chosen = low[1];
	}
	if (vision !== "default") {
		const override = palette.vision[vision].get(name);
		if (override) chosen = theme === 0 ? override[0] : override[1];
	}
	return chosen;
}

/** A translucent background is checked over every opaque surface it is drawn on. */
const translucentBases = ["canvas", "surface", "raised"];

/** The lowest contrast of `fg` on `bg` over every surface `bg` can sit on. */
export function contrastOn(
	palette: Palette,
	fg: string,
	bg: string,
	theme: Theme,
	vision: Vision = "default",
): number {
	const back = parse(tokenValue(palette, bg, theme, vision));
	const bases =
		back[3] < 1
			? translucentBases.map((name) => parse(tokenValue(palette, name, theme, vision)))
			: [back];
	return Math.min(
		...bases.map((base) => {
			const ground = over(back, base);
			return ratio(over(parse(tokenValue(palette, fg, theme, vision)), ground), ground);
		}),
	);
}

export const surfaces = ["canvas", "panel", "surface", "muted", "raised", "hover", "active"];
export const on = (fg: string, bgs: string[]): [string, string][] => bgs.map((bg) => [fg, bg]);

/** Text on a surface needs 4.5:1 (WCAG AA). Non-text marks such as input edges and the focus ring need 3:1. */
export const textPairs: [string, string][] = [
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

export const markPairs: [string, string][] = [
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
