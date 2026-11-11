/**
 * @feature CHAT-06 Code highlighting theme
 * Owns: the highlighting theme of chat code blocks, the file editor, the whole-file view and the
 * diff: which kind of token gets which colour, and whose chosen code theme applies.
 * Behaviour: measured from Conductor 0.92.1: its Default code theme (renderApp @365136) colours the
 * highlight.js token classes: comments (italic), keywords, tags, literals, strings, attributes and
 * variables and numbers, titles and symbols, built-ins and classes, additions and deletions. Shiki gives
 * TextMate scopes, so this file maps each scope family onto the same colour roles. The colours themselves
 * are tokens in styles.css (--color-code-*), so light and dark follow the app, and three light values are
 * raised to meet AA. A named code theme from the Appearance setting takes its own Shiki module; it
 * applies only in the mode it was made for, else the Default theme does, as Conductor's code themes do
 * (renderApp @1356648).
 * Must handle: one theme for light and dark (the tokens switch); a scope with no rule takes the text
 * colour; a named theme used in the other mode (the Default theme), and a setting the app no longer
 * offers (the Default theme).
 * Test first: "default" gives the Conducted Default theme in both modes, and Dracula gives Dracula in
 * dark but the Default theme in light.
 */
import type { ThemeRegistration } from "shiki";
import catppuccinLatte from "shiki/themes/catppuccin-latte.mjs";
import catppuccinMacchiato from "shiki/themes/catppuccin-macchiato.mjs";
import catppuccinMocha from "shiki/themes/catppuccin-mocha.mjs";
import dracula from "shiki/themes/dracula.mjs";
import gruvboxDark from "shiki/themes/gruvbox-dark-medium.mjs";
import nord from "shiki/themes/nord.mjs";
import solarizedDark from "shiki/themes/solarized-dark.mjs";
import tokyoNight from "shiki/themes/tokyo-night.mjs";

const color = (role: string) => `var(--color-code-${role})`;

export type CodeThemeMode = "light" | "dark";

/** The named code themes the Appearance setting offers, as Conductor's own theme registry holds them. */
const NAMED_THEMES: Readonly<Record<string, ThemeRegistration>> = {
	"catppuccin-latte": catppuccinLatte as unknown as ThemeRegistration,
	"catppuccin-macchiato": catppuccinMacchiato as unknown as ThemeRegistration,
	"catppuccin-mocha": catppuccinMocha as unknown as ThemeRegistration,
	dracula: dracula as unknown as ThemeRegistration,
	nord: nord as unknown as ThemeRegistration,
	"tokyo-night": tokyoNight as unknown as ThemeRegistration,
	"gruvbox-dark": gruvboxDark as unknown as ThemeRegistration,
	"solarized-dark": solarizedDark as unknown as ThemeRegistration,
};

export const CODE_THEME: ThemeRegistration = {
	name: "conducted-default",
	type: "dark",
	fg: color("fg"),
	bg: "transparent",
	colors: { "editor.foreground": color("fg"), "editor.background": "transparent" },
	tokenColors: [
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: { foreground: color("comment"), fontStyle: "italic" },
		},
		{
			scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.operator.new"],
			settings: { foreground: color("keyword") },
		},
		{
			scope: ["entity.name.tag", "entity.name.section", "markup.heading"],
			settings: { foreground: color("tag") },
		},
		{
			scope: ["constant.language", "keyword.operator"],
			settings: { foreground: color("keyword") },
		},
		{
			scope: ["string", "string.regexp", "markup.inline.raw"],
			settings: { foreground: color("string") },
		},
		{
			scope: [
				"constant.numeric",
				"variable",
				"variable.parameter",
				"entity.other.attribute-name",
				"support.type.property-name",
				"entity.name.type",
				"support.type",
				"meta.object-literal.key",
			],
			settings: { foreground: color("number") },
		},
		{
			scope: [
				"entity.name.function",
				"support.function",
				"meta.function-call",
				"constant.other.symbol",
				"markup.underline.link",
				"meta.preprocessor",
			],
			settings: { foreground: color("function") },
		},
		{
			scope: [
				"support.class",
				"entity.name.class",
				"entity.other.inherited-class",
				"support.constant",
			],
			settings: { foreground: color("class") },
		},
		{ scope: ["markup.inserted"], settings: { foreground: "var(--color-git-added)" } },
		{ scope: ["markup.deleted"], settings: { foreground: "var(--color-git-removed)" } },
		{ scope: ["markup.italic"], settings: { fontStyle: "italic" } },
		{ scope: ["markup.bold"], settings: { fontStyle: "bold" } },
	],
};

/** True when the app offers a named Shiki theme with this id. */
export function isNamedCodeTheme(themeName: string): boolean {
	return NAMED_THEMES[themeName] !== undefined;
}

/** The theme the user chose, in the app's current mode; the Default theme when it does not fit. */
export function codeThemeFor(themeName: string, mode: CodeThemeMode): ThemeRegistration {
	const chosen = NAMED_THEMES[themeName];
	return chosen !== undefined && chosen.type === mode ? chosen : CODE_THEME;
}
