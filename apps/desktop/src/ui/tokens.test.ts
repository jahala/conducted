import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const css = readFileSync(join(SRC, "styles.css"), "utf8");

type Pair = [light: string, dark: string];

/** `--color-x: light-dark(#aaa, #bbb);` gives both values; `--color-x: #aaa;` gives the same for both. */
function readColors(): Map<string, Pair> {
	const colors = new Map<string, Pair>();
	for (const match of css.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)) {
		const name = match[1];
		const value = match[2]?.trim();
		if (!name || !value || value === "initial") continue;
		const pair =
			/^light-dark\(\s*(#[0-9a-f]{6}|rgb\([^)]*\))\s*,\s*(#[0-9a-f]{6}|rgb\([^)]*\))\s*\)$/i.exec(
				value,
			);
		if (pair?.[1] && pair[2]) colors.set(name, [pair[1], pair[2]]);
		else if (/^#[0-9a-f]{6}$/i.test(value)) colors.set(name, [value, value]);
	}
	return colors;
}

function luminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return (
		0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
	);
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const colors = readColors();
const value = (name: string, theme: 0 | 1): string => {
	const pair = colors.get(name);
	if (!pair) throw new Error(`token --color-${name} is missing`);
	return pair[theme];
};

/** Text on a surface needs 4.5:1 (WCAG AA). Non-text marks such as input edges and the focus ring need 3:1. */
const textPairs: [string, string][] = [
	["fg", "canvas"],
	["fg", "surface"],
	["fg", "raised"],
	["fg", "hover"],
	["fg", "active"],
	["fg-muted", "canvas"],
	["fg-muted", "surface"],
	["fg-muted", "hover"],
	["fg-muted", "active"],
	["fg-subtle", "canvas"],
	["fg-subtle", "surface"],
	["fg-subtle", "hover"],
	["fg-subtle", "active"],
	["on-accent", "accent"],
	["on-accent", "accent-hover"],
	["accent", "canvas"],
	["accent", "surface"],
	["on-danger", "danger-solid"],
	["danger", "canvas"],
	["danger", "surface"],
	["warning", "canvas"],
	["warning", "surface"],
	["success", "canvas"],
	["success", "surface"],
];
const markPairs: [string, string][] = [
	["focus", "canvas"],
	["focus", "surface"],
	["border-strong", "canvas"],
];

describe("design tokens", () => {
	it("reads every token the tests rely on", () => {
		const names = new Set([...textPairs, ...markPairs].flat());
		expect([...colors.keys()]).toEqual(expect.arrayContaining([...names]));
	});

	describe.each([
		[0, "light"],
		[1, "dark"],
	] as const)("%s theme", (theme, label) => {
		it.each(textPairs)(`text %s on %s meets 4.5:1 in ${label}`, (fg, bg) => {
			expect(contrast(value(fg, theme), value(bg, theme))).toBeGreaterThanOrEqual(4.5);
		});
		it.each(markPairs)(`mark %s on %s meets 3:1 in ${label}`, (fg, bg) => {
			expect(contrast(value(fg, theme), value(bg, theme))).toBeGreaterThanOrEqual(3);
		});
	});

	it("keeps the type scale to the declared sizes", () => {
		const sizes = [...css.matchAll(/--text-([a-z0-9]+):/g)].map((m) => m[1]);
		expect(sizes).toEqual(["xs", "sm", "base", "lg", "xl", "2xl"]);
	});

	it("declares exactly two font families", () => {
		const families = [...css.matchAll(/--font-(sans|mono|[a-z]+):\s*(?!initial)/g)]
			.map((m) => m[1])
			.filter((name) => name !== "weight");
		expect(new Set(families)).toEqual(new Set(["sans", "mono"]));
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
