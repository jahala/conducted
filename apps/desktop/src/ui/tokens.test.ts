import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastOn, markPairs, over, parse, ratio, readPalette, textPairs } from "./contrast.ts";

const SRC = join(import.meta.dirname, "..");
const css = readFileSync(join(SRC, "styles.css"), "utf8");
const palette = readPalette(css);
const colors = palette.colors;
const lowColors = palette.low;

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
			expect(contrastOn(palette, fg, bg, theme)).toBeGreaterThanOrEqual(4.5);
		});
		it.each(markPairs)(`mark %s on %s meets 3:1 in ${label}`, (fg, bg) => {
			expect(contrastOn(palette, fg, bg, theme)).toBeGreaterThanOrEqual(3);
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
	// Every screen folder: a folder left out here is a folder nothing checks.
	const roots = ["ui", "app", "features"];
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
	const tailwindPalette =
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
			expect(tailwindPalette.exec(text)?.[0]).toBeUndefined();
		},
	);
});
