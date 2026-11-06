/**
 * @feature REV-08 The light or dark theme for code views
 * Owns: the one reading of whether the app shows light or dark: the root's `data-theme` when the
 * user forced one, else the system's colour scheme. Editors, diffs, code blocks and terminals
 * take their colours from it.
 * Behaviour: ui-map.md 6 (Appearance: theme follows the system or is forced) and 8 (code views
 * follow the app's mode).
 * Must handle: no `matchMedia` (light), the user switching the theme while a view is open (the
 * `data-theme` attribute changes), the system switching (the media query fires), and removing
 * both listeners on unmount.
 * Test first: setting data-theme="dark" on the root re-renders a reader with "dark".
 */
import { useEffect, useState } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function currentThemeType(): "light" | "dark" {
	const forced = document.documentElement.dataset.theme;
	if (forced === "light" || forced === "dark") return forced;
	return window.matchMedia?.(DARK_QUERY).matches === true ? "dark" : "light";
}

/** The light or dark theme as it stands now, and again whenever it changes. */
export function useThemeType(): "light" | "dark" {
	const [themeType, setThemeType] = useState<"light" | "dark">(currentThemeType);
	useEffect(() => {
		const update = (): void => setThemeType(currentThemeType());
		const media = window.matchMedia?.(DARK_QUERY);
		media?.addEventListener?.("change", update);
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => {
			media?.removeEventListener?.("change", update);
			observer.disconnect();
		};
	}, []);
	return themeType;
}
