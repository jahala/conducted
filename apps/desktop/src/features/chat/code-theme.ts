/**
 * @feature CHAT-06 Code highlighting theme
 * Owns: the highlighting theme of chat code blocks and the file viewer: which kind of token gets which
 * colour.
 * Behaviour: measured from Conductor 0.92.1: its Default code theme (renderApp @365136) colours the
 * highlight.js token classes: comments (italic), keywords, tags, literals, strings, attributes and
 * variables and numbers, titles and symbols, built-ins and classes, additions and deletions. Shiki gives
 * TextMate scopes, so this file maps each scope family onto the same colour roles. The colours themselves
 * are tokens in styles.css (--color-code-*), so light and dark follow the app, and three light values are
 * raised to meet AA.
 * Must handle: one theme for light and dark (the tokens switch); a scope with no rule takes the text colour.
 * Test first: not applicable; the CodeBlock tests render highlighted code with it.
 */
import type { ThemeRegistration } from "shiki";

const color = (role: string) => `var(--color-code-${role})`;

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
