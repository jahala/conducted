/**
 * @feature RUN-06 Terminal appearance
 * Owns: tests for the pure settings-and-token mapping into xterm options.
 * Test first: a dark token set gives a theme whose background equals the background token.
 */
import { describe, expect, it } from "vitest";
import {
	BYTES_PER_TERMINAL_LINE,
	DEFAULT_TERMINAL_FONT_FAMILY,
	DEFAULT_TERMINAL_FONT_SIZE,
	resolveTerminalAppearance,
	TERMINAL_THEME_TOKENS,
	type TerminalSettings,
} from "./terminal-theme.ts";

const darkTokens: Record<string, string> = Object.fromEntries(
	TERMINAL_THEME_TOKENS.map((name, index) => [name, `#${index.toString(16).padStart(6, "0")}`]),
);
darkTokens["--color-canvas"] = "#141110";
darkTokens["--color-fg"] = "#eae8e6";
darkTokens["--color-check"] = "#f3f2f1";
darkTokens["--color-on-check"] = "#2c2826";

const settings: TerminalSettings = {
	fontFamily: null,
	fontSize: null,
	scrollbackLimitBytes: 10_000_000,
	themeType: "dark",
};

const read = (tokens: Record<string, string>) => (name: string) => tokens[name] ?? null;

describe("RUN-06 terminal appearance", () => {
	it("gives a dark theme whose background comes from the background token", () => {
		const result = resolveTerminalAppearance(settings, read(darkTokens));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.theme.background).toBe("#141110");
		expect(result.value.theme.foreground).toBe("#eae8e6");
		expect(result.value.theme.selectionBackground).toBe("#f3f2f1");
		expect(result.value.theme.black).toBe(darkTokens["--color-term-black"]);
	});

	it("returns an error that names every missing colour token", () => {
		const incomplete = { ...darkTokens };
		delete incomplete["--color-term-red"];
		delete incomplete["--color-on-check"];
		const result = resolveTerminalAppearance(settings, read(incomplete));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toContain("--color-term-red");
		expect(result.error.message).toContain("--color-on-check");
	});

	it("keeps the Menlo-first fallback list and appends a chosen family", () => {
		const fallback = resolveTerminalAppearance(settings, read(darkTokens));
		expect(fallback.ok && fallback.value.fontFamily).toBe(DEFAULT_TERMINAL_FONT_FAMILY);

		const chosen = resolveTerminalAppearance(
			{ ...settings, fontFamily: "Berkeley Mono" },
			read(darkTokens),
		);
		expect(chosen.ok && chosen.value.fontFamily).toBe(
			`Berkeley Mono, ${DEFAULT_TERMINAL_FONT_FAMILY}`,
		);
	});

	it("uses 12px when the font size is unset and keeps a chosen size", () => {
		const fallback = resolveTerminalAppearance(settings, read(darkTokens));
		expect(fallback.ok && fallback.value.fontSize).toBe(DEFAULT_TERMINAL_FONT_SIZE);

		const chosen = resolveTerminalAppearance({ ...settings, fontSize: 15 }, read(darkTokens));
		expect(chosen.ok && chosen.value.fontSize).toBe(15);
	});

	it("converts the byte limit into xterm lines", () => {
		const result = resolveTerminalAppearance(
			{ ...settings, scrollbackLimitBytes: 1_000_000 },
			read(darkTokens),
		);
		expect(result.ok && result.value.scrollbackLines).toBe(1_000_000 / BYTES_PER_TERMINAL_LINE);
	});
});
