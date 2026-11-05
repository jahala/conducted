/**
 * @feature REV-02 Renderer options from preferences
 * Owns: the pure mapping from DiffPreferences and the current theme to the options object of
 * @pierre/diffs.
 * Behaviour: ui-map.md 3.6 and 8 (diff themes pierre-dark and pierre-light; the renderer follows
 * the Shiki code theme setting).
 * Renderer reference (checked in node_modules/@pierre/diffs/dist): `FileDiffOptions` from
 * "@pierre/diffs/react" has diffStyle ("unified" or "split"), overflow ("scroll" or "wrap"),
 * expandUnchanged (boolean, the "Entire file" switch), theme, themeType, disableFileHeader, and
 * parseDiffOptions.ignoreWhitespace for hiding whitespace changes.
 * Must handle: ignoreWhitespace only applying when the diff is computed from the two texts (when
 * only a patch exists, the services must produce a whitespace-free patch instead). An empty theme
 * name, or "default", means the renderer's own default for the light or dark type.
 * Test first: preferences { layout: "split", wrapLines: true } give diffStyle "split" and
 * overflow "wrap".
 */
import type { FileDiffOptions } from "@pierre/diffs/react";
import type { CommentAnnotation } from "./diff-annotations.ts";
import type { DiffPreferences, DiffTheme } from "./diff-types.ts";

/** The renderer's own defaults (ui-map.md 8). */
const DEFAULT_THEMES: Record<DiffTheme["type"], string> = {
	light: "pierre-light",
	dark: "pierre-dark",
};

export function toDiffOptions(
	preferences: DiffPreferences,
	theme: DiffTheme,
): FileDiffOptions<CommentAnnotation, undefined> {
	return {
		diffStyle: preferences.layout === "split" ? "split" : "unified",
		overflow: preferences.wrapLines ? "wrap" : "scroll",
		expandUnchanged: preferences.entireFile,
		theme:
			theme.name.length > 0 && theme.name !== "default" ? theme.name : DEFAULT_THEMES[theme.type],
		themeType: theme.type,
		disableFileHeader: true,
		parseDiffOptions: { ignoreWhitespace: preferences.hideWhitespaceChanges },
	};
}
