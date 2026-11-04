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
 * only a patch exists, the services must produce a whitespace-free patch instead), and a theme name
 * the renderer does not know (fall back to its default, reported in the log).
 * Test first: preferences { layout: "split", wrapLines: true } give diffStyle "split" and
 * overflow "wrap".
 */
import { notImplemented } from "@conducted/shared";
import type { FileDiffOptions } from "@pierre/diffs/react";
import type { CommentAnnotation } from "./diff-annotations.ts";
import type { DiffPreferences } from "./diff-types.ts";

export function toDiffOptions(
	_preferences: DiffPreferences,
	_theme: { name: string; type: "light" | "dark" },
): FileDiffOptions<CommentAnnotation, undefined> {
	return notImplemented("REV-02");
}
