/**
 * @feature SET-06 Terminal preview
 * Owns: a static block of coloured terminal text drawn with the terminal font, size and the sixteen
 * ANSI colours of the current theme.
 * Behaviour: ui-map.md 6, "Appearance page" (terminal preview block); ui-map.md 8 (terminal colour
 * tokens).
 * Our design choice: plain DOM text with token colours, not a live xterm, so the page stays light.
 * Must handle: a font size change applying at once, a missing font, and theme switches.
 * Test first: the preview shows all sixteen colour names once.
 */
import { notImplemented } from "@conducted/shared";

export interface TerminalPreviewProps {
	fontFamily: string;
	fontSize: number;
}

export function TerminalPreview(_props: TerminalPreviewProps): never {
	return notImplemented("SET-06");
}
