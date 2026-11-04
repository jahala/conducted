/**
 * @feature RUN-06 Terminal appearance
 * Owns: the pure mapping from app settings and design tokens to xterm options.
 * Behaviour: ui-map.md 6 (Appearance: "Terminal font", "Terminal Font Size"; Advanced: "Scrollback
 * limit") and 8 (tokens `terminal-*`, the 16 ANSI colours).
 * Library reference (checked in node_modules): `ITheme` from "@xterm/xterm" has foreground,
 * background, cursor, selectionBackground and the sixteen ANSI colour names.
 * Must handle: light and dark themes, a font family that is not installed (the fallback list is
 * kept), a scrollback limit given in bytes while xterm counts lines (convert with an assumed 100
 * bytes per line, Our design choice), and colour tokens that are missing (an error result, no
 * silent default).
 * Test first: a dark token set gives a theme whose background equals the background token.
 */
import { notImplemented } from "@conducted/shared";
import type { ITheme } from "@xterm/xterm";

export interface TerminalAppearance {
	fontFamily: string;
	fontSize: number;
	scrollbackLines: number;
	theme: ITheme;
}

export interface TerminalSettings {
	fontFamily: string | null;
	fontSize: number | null;
	scrollbackLimitBytes: number;
	themeType: "light" | "dark";
}

export function resolveTerminalAppearance(
	_settings: TerminalSettings,
	_readToken: (name: string) => string | null,
): TerminalAppearance {
	return notImplemented("RUN-06");
}
