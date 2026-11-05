/**
 * @feature SET-06 Appearance applied to the whole app
 * Owns: writing the appearance settings (theme, softer dark theme, colour-vision palette, sidebar
 * transparency and app zoom) onto <html> for every screen, the four shortcuts that change them from
 * any screen (Cmd+Alt+T switches the theme, Cmd++ or Cmd+= zooms in, Cmd+- zooms out, Cmd+0 resets
 * the zoom), and the zoom range the Appearance page shares.
 * Behaviour: ui-map.md 5.4 (the four shortcuts), 6 (Appearance), 8 (themes and colour variants).
 * Our design choice: mounted once in the root layout (app/router.tsx). A layout effect writes the
 * attributes before the browser paints the root, and the store listener writes them again in the
 * same task as every settings change. The shell waits for the settings to load (app/AppShell.tsx),
 * so the first shell it draws already has the saved theme and zoom. The zoom limits and default are
 * the registry's (`zoom_level_v2`); one step is 10%.
 * Must handle: an unknown stored value (no attribute, logged), a stored zoom outside the registry's
 * range (clamped to it), a save that fails (toast), and "System" theme: Cmd+Alt+T switches away from
 * the theme the user sees, so on a dark Mac the first press gives Light.
 * Test first: on /settings/general, Cmd+Alt+T stores "dark" and writes data-theme="dark".
 */
import type { Result } from "@conducted/shared";
import { useLayoutEffect } from "react";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions } from "../../../core/hooks.ts";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { toastError } from "../../../ui/Toast.tsx";
import { applyThemeOnChange, type StoredThemeValues } from "../../../ui/theme-variants.ts";

/** The zoom range and default the settings registry gives `zoom_level_v2`. */
function registryZoom(): { min: number; max: number; default: number } {
	const def = getSettingDef("zoom_level_v2");
	if (def?.type !== "number" || def.min === undefined || def.max === undefined) {
		throw new Error("The settings registry must give zoom_level_v2 a number range.");
	}
	return { min: def.min, max: def.max, default: def.default };
}

export const ZOOM = { ...registryZoom(), step: 0.1 } as const;

/** Keeps the zoom inside the registry's range and rounds to two decimals. */
export function clampZoom(value: number): number {
	if (!Number.isFinite(value)) return ZOOM.default;
	const clamped = Math.min(ZOOM.max, Math.max(ZOOM.min, value));
	return Math.round(clamped * 100) / 100;
}

/** One step in or out from the current zoom, never past the limits. */
function steppedZoom(value: number, direction: 1 | -1): number {
	return clampZoom(value + direction * ZOOM.step);
}

/** Writes the app zoom onto the document element. Returns the value that was applied. */
function applyZoom(
	root: { style: { setProperty(name: string, value: string): void } },
	value: number,
): number {
	const applied = clampZoom(value);
	root.style.setProperty("zoom", String(applied));
	return applied;
}

/**
 * The theme Cmd+Alt+T stores: the opposite of the one on screen. A stored value other than light or
 * dark follows macOS, as the document does.
 */
function toggledTheme(stored: unknown, systemDark: boolean): "light" | "dark" {
	const shown = stored === "light" || stored === "dark" ? stored : systemDark ? "dark" : "light";
	return shown === "dark" ? "light" : "dark";
}

const systemIsDark = (): boolean =>
	window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;

function saveInBackground(save: () => Promise<Result<void>>, title: string): void {
	void save().then((result) => {
		if (!result.ok) toastError(title, result.error);
	});
}

export function AppearanceController() {
	const { services, platform } = useServices();
	const actions = useActions();

	useLayoutEffect(() => {
		const root = document.documentElement;
		const disposeTheme = applyThemeOnChange(
			root,
			{
				read: (): StoredThemeValues => ({
					theme: services.settings.get<unknown>("theme"),
					lowContrastDark: services.settings.get<unknown>("low_contrast_dark_mode"),
					colorVision: services.settings.get<unknown>("color_vision"),
					vibrancy: services.settings.get<unknown>("experimental_sidebar_transparency"),
				}),
				subscribe: (listener) => services.settings.store.subscribe(listener),
			},
			(key, value) => {
				platform.app.writeLog("warn", "Unknown appearance setting value", { key, value });
			},
		);
		const applyStoredZoom = () => {
			applyZoom(root, services.settings.get<number>("zoom_level_v2"));
		};
		applyStoredZoom();
		const disposeZoom = services.settings.store.subscribe(applyStoredZoom);
		return () => {
			disposeTheme();
			disposeZoom();
		};
	}, [platform, services]);

	useCommandHandler("app.toggleTheme", "base", () => {
		const next = toggledTheme(services.settings.get<unknown>("theme"), systemIsDark());
		saveInBackground(() => actions.settings.set("theme", next), "Couldn't switch the theme");
		return true;
	});

	useCommandHandler("view.zoomIn", "base", () => {
		const current = services.settings.get<number>("zoom_level_v2");
		saveInBackground(
			() => actions.settings.set("zoom_level_v2", steppedZoom(current, 1)),
			"Couldn't zoom in",
		);
		return true;
	});

	useCommandHandler("view.zoomOut", "base", () => {
		const current = services.settings.get<number>("zoom_level_v2");
		saveInBackground(
			() => actions.settings.set("zoom_level_v2", steppedZoom(current, -1)),
			"Couldn't zoom out",
		);
		return true;
	});

	useCommandHandler("view.zoomReset", "base", () => {
		saveInBackground(
			() => actions.settings.set("zoom_level_v2", ZOOM.default),
			"Couldn't reset the zoom",
		);
		return true;
	});

	return null;
}
