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
import { appError, err, ok, type Result } from "@conducted/shared";
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

/** Menlo first, as ui-dimensions.md 1 records for Conductor's terminal. */
export const DEFAULT_TERMINAL_FONT_FAMILY =
	'Menlo, Monaco, "Courier New", "Symbols Nerd Font Mono", monospace';

export const DEFAULT_TERMINAL_FONT_SIZE = 12;
export const DEFAULT_TERMINAL_SCROLLBACK_BYTES = 10_000_000;

/** Our design choice: xterm counts lines, the setting counts bytes. */
export const BYTES_PER_TERMINAL_LINE = 100;

const ANSI_TOKENS = {
	black: "--color-term-black",
	red: "--color-term-red",
	green: "--color-term-green",
	yellow: "--color-term-yellow",
	blue: "--color-term-blue",
	magenta: "--color-term-magenta",
	cyan: "--color-term-cyan",
	white: "--color-term-white",
	brightBlack: "--color-term-bright-black",
	brightRed: "--color-term-bright-red",
	brightGreen: "--color-term-bright-green",
	brightYellow: "--color-term-bright-yellow",
	brightBlue: "--color-term-bright-blue",
	brightMagenta: "--color-term-bright-magenta",
	brightCyan: "--color-term-bright-cyan",
	brightWhite: "--color-term-bright-white",
} as const;

/** Every token the terminal theme reads, in the order an error lists them. */
export const TERMINAL_THEME_TOKENS = [
	"--color-canvas",
	"--color-fg",
	"--color-check",
	"--color-on-check",
	...Object.values(ANSI_TOKENS),
] as const;

function fontFamilyFor(setting: string | null): string {
	const chosen = setting?.trim();
	if (!chosen) return DEFAULT_TERMINAL_FONT_FAMILY;
	return `${chosen}, ${DEFAULT_TERMINAL_FONT_FAMILY}`;
}

function fontSizeFor(setting: number | null): number {
	return setting !== null && Number.isFinite(setting) && setting > 0
		? setting
		: DEFAULT_TERMINAL_FONT_SIZE;
}

function scrollbackLinesFor(bytes: number): number {
	return Math.max(1, Math.floor(bytes / BYTES_PER_TERMINAL_LINE));
}

export function resolveTerminalAppearance(
	settings: TerminalSettings,
	readToken: (name: string) => string | null,
): Result<TerminalAppearance> {
	const missing: string[] = [];
	const color = (name: string): string => {
		const value = readToken(name)?.trim();
		if (!value) {
			missing.push(name);
			return "";
		}
		return value;
	};

	const theme: ITheme = {
		background: color("--color-canvas"),
		foreground: color("--color-fg"),
		cursor: color("--color-fg"),
		cursorAccent: color("--color-canvas"),
		selectionBackground: color("--color-check"),
		selectionForeground: color("--color-on-check"),
		black: color(ANSI_TOKENS.black),
		red: color(ANSI_TOKENS.red),
		green: color(ANSI_TOKENS.green),
		yellow: color(ANSI_TOKENS.yellow),
		blue: color(ANSI_TOKENS.blue),
		magenta: color(ANSI_TOKENS.magenta),
		cyan: color(ANSI_TOKENS.cyan),
		white: color(ANSI_TOKENS.white),
		brightBlack: color(ANSI_TOKENS.brightBlack),
		brightRed: color(ANSI_TOKENS.brightRed),
		brightGreen: color(ANSI_TOKENS.brightGreen),
		brightYellow: color(ANSI_TOKENS.brightYellow),
		brightBlue: color(ANSI_TOKENS.brightBlue),
		brightMagenta: color(ANSI_TOKENS.brightMagenta),
		brightCyan: color(ANSI_TOKENS.brightCyan),
		brightWhite: color(ANSI_TOKENS.brightWhite),
	};

	if (missing.length > 0) {
		return err(
			appError("terminal_theme_incomplete", `Terminal colours are missing: ${missing.join(", ")}.`),
		);
	}

	return ok({
		fontFamily: fontFamilyFor(settings.fontFamily),
		fontSize: fontSizeFor(settings.fontSize),
		scrollbackLines: scrollbackLinesFor(settings.scrollbackLimitBytes),
		theme,
	});
}
