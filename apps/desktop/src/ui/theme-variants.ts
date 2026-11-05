/**
 * @feature APP-14 Theme variants
 * Owns: turning the appearance settings into the attributes on <html> that pick a token set.
 * Behaviour: ui-map.md 8 (themes: light, dark, low-contrast dark, colour-vision variants); ui-dimensions.md 2.2
 * (low-contrast dark replacements) and 2.6 (protanopia and deuteranopia turn success and added colours blue and
 * danger and removed colours orange; tritanopia turns success and added colours blue and leaves red).
 * The token sets and their contrast guard live in styles.css and this folder's tests.
 * Our design choice: an unknown setting value sets no attribute and is reported to the caller, so the document
 * falls back to the system theme instead of guessing a value.
 * Must handle: "system" theme removes data-theme so light-dark() follows macOS; low contrast only changes dark
 * values; a colour-vision choice combines with any theme; the vibrancy setting turns the translucent sidebar
 * surface on; unknown setting values fall back to no attribute and are reported.
 * Test first: { theme: "dark", lowContrastDark: true, colorVision: "tritanopia", vibrancy: true } gives
 * data-theme="dark", data-contrast="low", data-color-vision="tritanopia" and data-vibrancy="on";
 * changing that setting through applyThemeOnChange changes document.documentElement.
 */

export type ThemeChoice = "light" | "dark" | "system";
export type ColorVision = "default" | "protanopia-deuteranopia" | "tritanopia";

export interface ThemeVariantSettings {
	theme: ThemeChoice;
	lowContrastDark: boolean;
	colorVision: ColorVision;
	/** The `experimental_sidebar_transparency` setting: the macOS vibrancy effect behind the sidebar. */
	vibrancy: boolean;
}

/** The raw values a settings row can hold: they are validated here, never trusted by type alone. */
export interface StoredThemeValues {
	theme: unknown;
	lowContrastDark: unknown;
	colorVision: unknown;
	vibrancy: unknown;
}

/** The attributes to set on <html>. An attribute that is absent is removed. */
export interface ThemeAttributes {
	"data-theme"?: "light" | "dark";
	"data-contrast"?: "low";
	"data-color-vision"?: Exclude<ColorVision, "default">;
	"data-vibrancy"?: "on";
}

/** The part of an element this module writes to. The document element satisfies it. */
export interface ThemeAttributeRoot {
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
}

export type UnknownThemeSetting = (key: keyof StoredThemeValues, value: unknown) => void;

export function themeAttributes(
	settings: ThemeVariantSettings | StoredThemeValues,
	onUnknown?: UnknownThemeSetting,
): ThemeAttributes {
	const attributes: ThemeAttributes = {};

	if (settings.theme === "light" || settings.theme === "dark") {
		attributes["data-theme"] = settings.theme;
	} else if (settings.theme !== "system") {
		onUnknown?.("theme", settings.theme);
	}

	if (settings.lowContrastDark === true) {
		attributes["data-contrast"] = "low";
	} else if (settings.lowContrastDark !== false) {
		onUnknown?.("lowContrastDark", settings.lowContrastDark);
	}

	if (settings.colorVision === "protanopia-deuteranopia" || settings.colorVision === "tritanopia") {
		attributes["data-color-vision"] = settings.colorVision;
	} else if (settings.colorVision !== "default") {
		onUnknown?.("colorVision", settings.colorVision);
	}

	if (settings.vibrancy === true) {
		attributes["data-vibrancy"] = "on";
	} else if (settings.vibrancy !== false) {
		onUnknown?.("vibrancy", settings.vibrancy);
	}

	return attributes;
}

const ATTRIBUTE_NAMES = [
	"data-theme",
	"data-contrast",
	"data-color-vision",
	"data-vibrancy",
] as const;

/** Writes the attributes to the document element and removes the ones this setting does not use. */
export function applyThemeAttributes(
	root: ThemeAttributeRoot,
	settings: ThemeVariantSettings | StoredThemeValues,
	onUnknown?: UnknownThemeSetting,
): ThemeAttributes {
	const attributes = themeAttributes(settings, onUnknown);
	for (const name of ATTRIBUTE_NAMES) {
		const value = attributes[name];
		if (value === undefined) root.removeAttribute(name);
		else root.setAttribute(name, value);
	}
	return attributes;
}

/** The settings store as this module needs it: a current value and a way to hear about changes. */
export interface ThemeSettingSource {
	read(): ThemeVariantSettings | StoredThemeValues;
	subscribe(listener: () => void): () => void;
}

/**
 * Applies the attributes now and again after every source change, so the appearance settings reach
 * <html> as they change. Returns the dispose that removes the subscription.
 */
export function applyThemeOnChange(
	root: ThemeAttributeRoot,
	source: ThemeSettingSource,
	onUnknown?: UnknownThemeSetting,
): () => void {
	const apply = () => {
		applyThemeAttributes(root, source.read(), onUnknown);
	};
	apply();
	return source.subscribe(apply);
}
