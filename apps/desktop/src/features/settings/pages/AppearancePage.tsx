/**
 * @feature SET-06 Appearance settings page
 * Owns: the Appearance page of Settings: theme, colours, zoom, fonts, and live previews.
 * Behaviour: ui-map.md 6, "Appearance" table and "Appearance page" (live code preview and a
 * terminal preview block); ui-map.md 8 (themes: light, dark, low-contrast dark, colour-vision
 * variants; code themes through Shiki).
 * Rows (our wording), key, control:
 *   Theme                         (theme, set by SET-01)       select: Light, Dark, System
 *   Softer dark mode              low_contrast_dark_mode       toggle
 *   Colour-blind friendly colours color_vision                 select: Default, Protanopia and
 *                                                              deuteranopia, Tritanopia
 *   App zoom                      zoom_level_v2                slider with a reset
 *   Code theme                    code_theme                   select (Shiki bundled themes)
 *   Code font                     mono_font                    select: Default or Custom
 *   Ligatures in code             file_ligatures_enabled       toggle
 *   Markdown style                markdown_style               select: Default, Tufte
 *   Terminal font and size        terminal_font_family,
 *                                 terminal_font_size           font select and number
 *   Coloured diff bars in the     colored_sidebar_diffs        toggle
 *   sidebar
 * Children: appearance/CodePreview, appearance/TerminalPreview.
 * Library reference (checked in node_modules): `codeToHtml` and `bundledThemes` from "shiki".
 * Must handle: a chosen font that is not installed (the preview shows the fallback and a note),
 * zoom limits (50% to 200%, Our design choice), changes applying live and reverting on a failed
 * save, System theme following macOS changes, and contrast: every theme combination must keep text
 * at WCAG AA contrast.
 * Test first: changing the code theme re-renders the code preview with that theme name.
 */
import { notImplemented } from "@conducted/shared";

export function AppearancePage(): never {
	return notImplemented("SET-06");
}
