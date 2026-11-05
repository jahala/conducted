/**
 * @feature APP-14 Theme variants
 * Owns: turning the appearance settings into the attributes on <html> that pick a token set, and the token
 * sets styles.css does not have yet.
 * Behaviour: ui-map.md 8 (themes: light, dark, low-contrast dark, colour-vision variants); ui-dimensions.md 2.2
 * (low-contrast dark replacements), 2.6 (colour-vision variants: protanopia and deuteranopia turn success and
 * added colours blue and danger and removed colours orange; tritanopia turns them blue and leaves red), 2.5
 * (terminal colours) and 3 (the sidebar drawn at 60% over the window for vibrancy).
 * Already in styles.css: the low-contrast dark set under data-contrast="low", link colours and the sixteen
 * terminal colours. Still to build: setting the attributes from the settings `theme`, `low_contrast_dark_mode`
 * and `color_vision`; the colour-vision token sets; a search-highlight colour; the translucent sidebar surface;
 * and AA checks for the terminal colours (several of Conductor's light ones, such as yellow and white, fall
 * under 4.5:1 on the light terminal background) and for every theme and colour-vision combination.
 * Must handle: "system" theme removes data-theme so light-dark() follows macOS; low contrast only changes dark
 * values; a colour-vision choice combines with any theme; unknown setting values fall back to no attribute and
 * are reported, never guessed.
 * Test first: { theme: "dark", lowContrastDark: true, colorVision: "tritanopia" } gives data-theme="dark",
 * data-contrast="low" and data-color-vision="tritanopia".
 */
import { notImplemented } from "@conducted/shared";

export type ThemeChoice = "light" | "dark" | "system";
export type ColorVision = "default" | "protanopia-deuteranopia" | "tritanopia";

export interface ThemeVariantSettings {
	theme: ThemeChoice;
	lowContrastDark: boolean;
	colorVision: ColorVision;
}

/** The attributes to set on <html>. An attribute that is absent is removed. */
export interface ThemeAttributes {
	"data-theme"?: "light" | "dark";
	"data-contrast"?: "low";
	"data-color-vision"?: Exclude<ColorVision, "default">;
}

export function themeAttributes(_settings: ThemeVariantSettings): ThemeAttributes {
	return notImplemented("APP-14");
}
