/**
 * @feature SET-06 Code preview
 * Owns: a short code sample drawn with the current code theme, font and ligature settings, so the
 * user sees a change before leaving the page.
 * Behaviour: ui-map.md 6, "Appearance page" (live code preview).
 * Library reference (checked in node_modules): `codeToHtml(code, { lang, theme })` from "shiki".
 * Must handle: a theme name Shiki does not bundle (an error note, previous preview kept), a font
 * that is missing, rendering failing, and light or dark app themes.
 * Test first: changing the theme prop re-renders with the new theme name.
 */
import { notImplemented } from "@conducted/shared";

export interface CodePreviewProps {
	themeName: string;
	fontFamily: string | null;
	ligatures: boolean;
}

export function CodePreview(_props: CodePreviewProps): never {
	return notImplemented("SET-06");
}
