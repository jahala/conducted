/**
 * @feature SET-06 Code preview
 * Owns: a short code sample drawn with the chosen code theme, code font and ligature setting, so
 * the user sees a change before leaving the page.
 * Behaviour: ui-map.md 6 (Appearance page, live code preview); ui-map.md 8 (the code themes and
 * their colours).
 * Library reference (checked in node_modules): the theme modules under `shiki/themes/*` carry each
 * bundled theme's editor colours and syntax scopes. The Default theme takes Conductor's own palette
 * from ui-dimensions.md 2.6.
 * Our design choice: the preview draws a fixed sample with the theme's own colours instead of
 * running a highlighter, so it paints at once and stays light.
 * Must handle: a theme name the app does not offer (a note and the Default palette), a font that is
 * missing (the mono fallback), and light or dark themes (`light-dark()` for Default).
 * Test first: changing the theme prop re-renders with the new theme name.
 */
import catppuccinLatte from "shiki/themes/catppuccin-latte.mjs";
import catppuccinMacchiato from "shiki/themes/catppuccin-macchiato.mjs";
import catppuccinMocha from "shiki/themes/catppuccin-mocha.mjs";
import dracula from "shiki/themes/dracula.mjs";
import gruvboxDark from "shiki/themes/gruvbox-dark-medium.mjs";
import nord from "shiki/themes/nord.mjs";
import solarizedDark from "shiki/themes/solarized-dark.mjs";
import tokyoNight from "shiki/themes/tokyo-night.mjs";
import { getSettingDef } from "../../../core/registries/settings.ts";

export interface CodePreviewProps {
	themeName: string;
	fontFamily: string | null;
	ligatures: boolean;
}

type Role = "text" | "keyword" | "type" | "string" | "function" | "number" | "comment" | "variable";

interface Palette {
	background: string;
	text: string;
	keyword: string;
	type: string;
	string: string;
	function: string;
	number: string;
	comment: string;
	variable: string;
}

interface ThemeModule {
	colors?: Record<string, string>;
	tokenColors?: {
		scope?: string | string[];
		settings?: { foreground?: string };
	}[];
}

interface SampleToken {
	id: string;
	text: string;
	role: Role;
}

const SAMPLE: SampleToken[][] = [
	[
		{ id: "type", text: "type", role: "keyword" },
		{ id: "place-type", text: " Place", role: "type" },
		{ id: "type-open", text: " = { ", role: "text" },
		{ id: "name-key", text: "name", role: "variable" },
		{ id: "type-colon", text: ": ", role: "text" },
		{ id: "string-type", text: "string", role: "type" },
		{ id: "type-close", text: " };", role: "text" },
	],
	[],
	[
		{ id: "const", text: "const", role: "keyword" },
		{ id: "greet-name", text: " greet", role: "function" },
		{ id: "greet-open", text: " = (", role: "text" },
		{ id: "place-arg", text: "place", role: "variable" },
		{ id: "place-colon", text: ": ", role: "text" },
		{ id: "place-type-arg", text: "Place", role: "type" },
		{ id: "times-arg", text: ", times = ", role: "text" },
		{ id: "times-one", text: "1", role: "number" },
		{ id: "greet-return-type", text: "): ", role: "text" },
		{ id: "string-return", text: "string", role: "type" },
		{ id: "arrow", text: " => {", role: "text" },
	],
	[{ id: "comment", text: "\t// Say hello.", role: "comment" }],
	[
		{ id: "return", text: "\treturn ", role: "keyword" },
		{ id: "template-open", text: "`Hello, ", role: "string" },
		{ id: "template-start", text: "${", role: "keyword" },
		{ id: "template-variable", text: "place.name", role: "variable" },
		{ id: "template-close", text: "}!", role: "string" },
		{ id: "template-end", text: "`;", role: "string" },
	],
	[{ id: "close", text: "};", role: "text" }],
];

const THEMES: Readonly<Record<string, ThemeModule>> = {
	"catppuccin-latte": catppuccinLatte as unknown as ThemeModule,
	"catppuccin-macchiato": catppuccinMacchiato as unknown as ThemeModule,
	"catppuccin-mocha": catppuccinMocha as unknown as ThemeModule,
	dracula: dracula as unknown as ThemeModule,
	nord: nord as unknown as ThemeModule,
	"tokyo-night": tokyoNight as unknown as ThemeModule,
	"gruvbox-dark": gruvboxDark as unknown as ThemeModule,
	"solarized-dark": solarizedDark as unknown as ThemeModule,
};

/** Conductor's own Default code palette, light and dark (ui-dimensions.md 2.6). */
const DEFAULT_PALETTE: Palette = {
	background: "light-dark(hsl(30 9% 95%), hsl(24 9% 12%))",
	text: "light-dark(hsl(25 8% 16%), hsl(30 8% 91%))",
	comment: "light-dark(hsl(23 5% 63%), hsl(22 4% 54%))",
	keyword: "light-dark(hsl(0 72% 51%), hsl(0 91% 71%))",
	string: "light-dark(hsl(360 13% 31%), hsl(22 39% 78%))",
	number: "light-dark(hsl(221 83% 53%), hsl(213 94% 68%))",
	function: "light-dark(hsl(292 100% 46%), hsl(292 100% 66%))",
	type: "light-dark(hsl(20 90% 48%), hsl(27 96% 61%))",
	variable: "light-dark(hsl(25 8% 16%), hsl(30 8% 91%))",
};

function scopesOf(entry: NonNullable<ThemeModule["tokenColors"]>[number]): string[] {
	if (entry.scope === undefined) return [];
	return Array.isArray(entry.scope) ? entry.scope : [entry.scope];
}

function colourFor(theme: ThemeModule, targets: readonly string[], fallback: string): string {
	for (const target of targets) {
		for (const entry of theme.tokenColors ?? []) {
			const matched = scopesOf(entry).some(
				(scope) => scope === target || scope.startsWith(`${target}.`),
			);
			if (matched && entry.settings?.foreground !== undefined) return entry.settings.foreground;
		}
	}
	return fallback;
}

function paletteFor(themeName: string): Palette | null {
	if (themeName === "default") return DEFAULT_PALETTE;
	const theme = THEMES[themeName];
	if (theme === undefined) return null;
	const colors = theme.colors ?? {};
	const text = colors["editor.foreground"] ?? colors.foreground ?? "#000000";
	return {
		background: colors["editor.background"] ?? colors.background ?? "transparent",
		text,
		keyword: colourFor(theme, ["keyword", "storage"], text),
		type: colourFor(theme, ["entity.name.type", "entity.name.class", "support.type"], text),
		string: colourFor(theme, ["string"], text),
		function: colourFor(theme, ["entity.name.function", "support.function"], text),
		number: colourFor(theme, ["constant.numeric", "constant.language", "constant"], text),
		comment: colourFor(theme, ["comment"], text),
		variable: colourFor(theme, ["variable"], text),
	};
}

function themeLabel(themeName: string): string {
	const def = getSettingDef("code_theme");
	if (def?.type === "enum") {
		const option = def.options.find((entry) => entry.value === themeName);
		if (option !== undefined) return option.label;
	}
	return themeName;
}

function codeFont(fontFamily: string | null): string {
	const chosen = fontFamily?.trim() ?? "";
	return chosen === "" ? "var(--font-mono)" : `${chosen}, var(--font-mono)`;
}

function featureSettings(ligatures: boolean): string {
	return ligatures ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0';
}

export function CodePreview({ themeName, fontFamily, ligatures }: CodePreviewProps) {
	const palette = paletteFor(themeName);
	const unknownTheme = palette === null;
	const shown = palette ?? DEFAULT_PALETTE;

	return (
		<figure
			aria-label="Code preview"
			data-code-theme={themeName}
			data-code-font={fontFamily ?? "default"}
			data-ligatures={ligatures ? "on" : "off"}
			className="flex flex-col overflow-hidden rounded-lg border border-border bg-canvas"
		>
			<figcaption className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-2xs">
				<span className="font-medium text-fg-muted">Code</span>
				<span className="text-fg-muted">{themeLabel(themeName)}</span>
			</figcaption>
			<pre
				className="m-0 overflow-x-auto p-3 text-code"
				style={{
					background: shown.background,
					color: shown.text,
					fontFamily: codeFont(fontFamily),
					fontFeatureSettings: featureSettings(ligatures),
				}}
			>
				<code>
					{SAMPLE.map((line, lineIndex) => (
						<span key={line.map((token) => token.id).join("-") || "blank"}>
							{line.map((token) => (
								<span key={token.id} style={{ color: shown[token.role] }}>
									{token.text}
								</span>
							))}
							{lineIndex < SAMPLE.length - 1 ? "\n" : ""}
						</span>
					))}
				</code>
			</pre>
			{unknownTheme ? (
				<p role="alert" className="border-t border-border px-3 py-1.5 text-xs text-danger">
					The code theme &quot;{themeLabel(themeName)}&quot; is not available. Showing the Default
					theme.
				</p>
			) : null}
		</figure>
	);
}
