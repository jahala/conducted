import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const css = readFileSync(join(SRC, "styles.css"), "utf8");

type Pair = [light: string, dark: string];

const HEX = "#[0-9a-f]{6}(?:[0-9a-f]{2})?";
const pairPattern = new RegExp(`^light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)$`, "i");
const singlePattern = new RegExp(`^${HEX}$`, "i");

/** `--color-x: light-dark(#aaa, #bbb);` gives both values; `--color-x: #aaa;` gives the same for both.
 * Values may carry an alpha byte (#rrggbbaa). Values that are not plain hex (color-mix) are skipped. */
function readColors(text: string): Map<string, Pair> {
	const colors = new Map<string, Pair>();
	for (const match of text.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
		const name = match[1];
		const value = match[2]?.trim();
		if (!name || !value || value === "initial") continue;
		const pair = pairPattern.exec(value);
		if (pair?.[1] && pair[2]) colors.set(name, [pair[1], pair[2]]);
		else if (singlePattern.test(value)) colors.set(name, [value, value]);
	}
	return colors;
}

const lowBlock = /:root\[data-contrast="low"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
const mainCss = css.replace(lowBlock, "");
const colors = readColors(mainCss);
const lowColors = readColors(lowBlock);

type Rgba = [r: number, g: number, b: number, a: number];

function parse(hex: string): Rgba {
	const n = Number.parseInt(hex.slice(1, 7), 16);
	const a = hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** Paints a colour that may be translucent over an opaque one. */
function over(top: Rgba, under: Rgba): Rgba {
	const [r, g, b, a] = top;
	return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** Themes: 0 light, 1 dark, 2 low-contrast dark (dark with the low block's replacements). */
type Theme = 0 | 1 | 2;
const value = (name: string, theme: Theme): string => {
	const pair = theme === 2 ? (lowColors.get(name) ?? colors.get(name)) : colors.get(name);
	if (!pair) throw new Error(`token --color-${name} is missing`);
	return pair[theme === 0 ? 0 : 1];
};

/** A translucent background (hover) is checked over each opaque surface it is drawn on. */
const translucentBases = ["canvas", "surface", "raised"];

/** The lowest contrast of `fg` on `bg` over every surface `bg` can sit on. */
function contrast(fg: string, bg: string, theme: Theme): number {
	const back = parse(value(bg, theme));
	const bases = back[3] < 1 ? translucentBases.map((b) => parse(value(b, theme))) : [back];
	return Math.min(
		...bases.map((base) => {
			const ground = over(back, base);
			return ratio(over(parse(value(fg, theme)), ground), ground);
		}),
	);
}

const surfaces = ["canvas", "panel", "surface", "muted", "raised", "hover", "active"];
const on = (fg: string, bgs: string[]): [string, string][] => bgs.map((bg) => [fg, bg]);

/** Text on a surface needs 4.5:1 (WCAG AA). Non-text marks such as input edges and the focus ring need 3:1. */
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

describe("design tokens", () => {
	it("reads every token the tests rely on", () => {
		const names = new Set([...textPairs, ...markPairs].flat());
		expect([...colors.keys()]).toEqual(expect.arrayContaining([...names]));
	});

	describe.each([
		[0, "light"],
		[1, "dark"],
		[2, "low-contrast dark"],
	] as const)("%s theme", (theme, label) => {
		it.each(textPairs)(`text %s on %s meets 4.5:1 in ${label}`, (fg, bg) => {
			expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(4.5);
		});
		it.each(markPairs)(`mark %s on %s meets 3:1 in ${label}`, (fg, bg) => {
			expect(contrast(fg, bg, theme)).toBeGreaterThanOrEqual(3);
		});
	});

	it("changes only dark values in the low-contrast set", () => {
		expect(lowColors.size).toBeGreaterThan(0);
		for (const [name, [light]] of lowColors) {
			expect(colors.get(name)?.[0], `--color-${name}`).toBe(light);
		}
	});

	it("checks itself on known cases", () => {
		expect(ratio(parse("#000000"), parse("#ffffff"))).toBeCloseTo(21, 1);
		expect(ratio(parse("#767676"), parse("#ffffff"))).toBeCloseTo(4.54, 2);
		// Black at alpha 0x80 over white is #7f7f7f, which gives 4.0 on white.
		expect(ratio(over(parse("#00000080"), parse("#ffffff")), parse("#ffffff"))).toBeCloseTo(4.0, 1);
	});

	it("keeps the type scale to Conductor's names", () => {
		const sizes = [...css.matchAll(/--text-([a-z0-9]+):/g)].map((m) => m[1]);
		expect(sizes).toEqual(["3xs", "2xs", "xs", "sm", "code", "base", "lg", "xl", "2xl"]);
	});

	it("makes text-sm the 14px body size", () => {
		expect(/--text-sm:\s*0\.875rem;/.test(css)).toBe(true);
		expect(/font-size:\s*var\(--text-sm\);/.test(css)).toBe(true);
	});

	it("declares exactly the five weights Conductor uses", () => {
		const weights = [...css.matchAll(/--font-weight-([a-z]+):\s*(\d+);/g)].map((m) => Number(m[2]));
		expect(weights).toEqual([350, 400, 450, 500, 600]);
	});

	it("declares exactly two font families", () => {
		const families = [...css.matchAll(/--font-(sans|mono|[a-z]+):\s*(?!initial)/g)]
			.map((m) => m[1])
			.filter((name) => name !== "weight");
		expect(new Set(families)).toEqual(new Set(["sans", "mono"]));
	});

	it("bundles a font file for each family, with its licence", () => {
		const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
		const families = faces.map((face) => /font-family:\s*"([^"]+)"/.exec(face)?.[1]);
		expect(families).toEqual(["Geist", "Geist Mono"]);
		for (const face of faces) {
			const url = /url\("([^"]+)"\)/.exec(face)?.[1];
			expect(url && statSync(join(SRC, url)).size).toBeGreaterThan(0);
		}
		expect(readFileSync(join(SRC, "assets/fonts/OFL.txt"), "utf8")).toContain(
			"SIL Open Font License",
		);
	});
});

/** Every colour must come from the tokens: no hex values and no default Tailwind palette in components. */
describe("components use tokens only", () => {
	const roots = [
		"ui",
		"app",
		"features/sidebar",
		"features/home",
		"features/dashboard",
		"features/passport",
		"features/workspace",
		"features/chat",
		"features/composer",
		"features/palette",
		"features/onboarding",
	];
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
		}
	};
	for (const root of roots) walk(join(SRC, root));

	const hex = /#[0-9a-fA-F]{3,8}\b/;
	const palette =
		/\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d+)?\b/;

	it("finds source files to check", () => {
		expect(files.length).toBeGreaterThan(50);
	});

	it.each(files.map((f) => [relative(SRC, f), f]))(
		"%s has no hard-coded colours",
		(_name, file) => {
			const text = readFileSync(file as string, "utf8")
				// Comments may name colours; only code counts.
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			expect(hex.exec(text)?.[0]).toBeUndefined();
			expect(palette.exec(text)?.[0]).toBeUndefined();
		},
	);
});
