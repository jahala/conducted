/**
 * @feature REV-02 Diff theme
 * Owns: turning the user's code theme setting into the pair of Shiki theme names the diff renderer
 * and the whole-file view ask for, and registering Conducted's Default theme with that renderer.
 * Behaviour: ui-map.md 3.6 and 8 (the diff follows the code theme setting). Measured from Conductor
 * 0.92.1 (renderApp @1356648): a named code theme is used in the mode it was made for; the other
 * mode falls back to the app's own Default theme. The Default theme's colours are CSS variables, so
 * one registration serves light and dark while the app follows its tokens.
 * Library reference: `registerCustomTheme` from "@pierre/diffs" takes a name and a loader that
 * resolves a Shiki `ThemeRegistration`. A name registered twice throws, so registration runs once.
 * Must handle: the "default" setting, a named theme with only one mode, an unknown setting, and a
 * registration that ran already.
 * Test first: the Default setting names the Conducted Default theme in both modes, and Dracula is
 * used in dark but not in light.
 */
import { registerCustomTheme } from "@pierre/diffs";
import type { ThemeRegistration } from "shiki";
import { CODE_THEME, codeThemeFor, isNamedCodeTheme } from "../chat/code-theme.ts";
import type { DiffTheme } from "./diff-types.ts";

const DEFAULT_DARK = "conducted-default-dark";
const DEFAULT_LIGHT = "conducted-default-light";

/** Conducted's Default theme under the name the renderer will look up. */
function defaultTheme(name: string, type: "light" | "dark"): ThemeRegistration {
	return { ...CODE_THEME, name, type };
}

let registered = false;

/** Registers the Default theme with @pierre/diffs once. Safe to call from every reader. */
export function registerDiffThemes(): void {
	if (registered) return;
	registered = true;
	registerCustomTheme(DEFAULT_DARK, async () => defaultTheme(DEFAULT_DARK, "dark"));
	registerCustomTheme(DEFAULT_LIGHT, async () => defaultTheme(DEFAULT_LIGHT, "light"));
}

/** The Shiki theme names for the diff renderer, given the code theme setting and the app's mode. */
export function diffThemeFor(themeName: string, type: "light" | "dark"): DiffTheme {
	registerDiffThemes();
	const chosen = codeThemeFor(themeName, type);
	if (isNamedCodeTheme(themeName) && chosen !== CODE_THEME) {
		return { name: themeName, type };
	}
	return { name: type === "dark" ? DEFAULT_DARK : DEFAULT_LIGHT, type };
}
