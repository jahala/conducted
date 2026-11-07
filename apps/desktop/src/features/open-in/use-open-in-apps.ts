/**
 * @feature WS-08 Open a workspace in another app
 * Owns: the apps the "Open in" menu lists and the one it opens by default, read by the menu, by
 * the file tab's "Open in another app" (REV-08) and by Settings' "Open settings.toml", so all
 * choose the same app; and `useOpenInChoices`, which records the last used app and the default.
 * Behaviour: ui-map.md 3.10; services-map.md 4.2.3 (`default_open_in`, `open_in_mru_order`).
 * Must handle: the installed-apps list loading or failing (Finder alone is listed), a stored default
 * that is not installed (the first listed app is used).
 * Test first: with no stored default, the file tab opens a file in the first listed app.
 */
import { useCallback, useMemo } from "react";
import { useActions, useInstalledApps, useSetting } from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";
import {
	defaultOpenInApp,
	type OpenInApp,
	openInCatalog,
	visibleOpenInApps,
} from "./open-in-apps.ts";

const NO_APPS: readonly string[] = [];

const parseRecent = (value: string): string[] =>
	value
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name !== "");

export interface OpenInApps {
	apps: OpenInApp[];
	/** The app a plain "Open in" opens: the stored default when listed, else the first app. */
	defaultApp: OpenInApp | null;
	/** The stored `default_open_in` value; empty when the user never chose one. */
	storedDefault: string;
	/** App names, most recently used first (`open_in_mru_order`). */
	recentNames: string[];
	/** True when the installed apps could not be listed; Finder alone is then shown. */
	listFailed: boolean;
}

export function useOpenInApps(): OpenInApps {
	const installed = useInstalledApps();
	const storedDefault = useSetting<string>("default_open_in");
	const recentSetting = useSetting<string>("open_in_mru_order");
	const recentNames = useMemo(() => parseRecent(recentSetting), [recentSetting]);
	const installedNames = installed.state === "ready" ? installed.data : NO_APPS;
	const apps = useMemo(
		() => visibleOpenInApps(openInCatalog(), installedNames, recentNames),
		[installedNames, recentNames],
	);
	return {
		apps,
		defaultApp: defaultOpenInApp(apps, storedDefault),
		storedDefault,
		recentNames,
		listFailed: installed.state === "error",
	};
}

export interface OpenInChoices {
	/** Puts the app first in the recently used list, after it opened something. */
	remember: (app: OpenInApp) => Promise<void>;
	/** Makes the app the one a plain "Open in" opens. */
	setDefault: (app: OpenInApp) => void;
}

/** The two choices every Open in control writes to the settings, with their failure toasts. */
export function useOpenInChoices(recentNames: readonly string[]): OpenInChoices {
	const actions = useActions();
	const remember = useCallback(
		async (app: OpenInApp) => {
			const next = [app.appName, ...recentNames.filter((name) => name !== app.appName)];
			const written = await actions.settings.set("open_in_mru_order", next.join(","));
			if (!written.ok) toastError("Couldn't remember the last app", written.error);
		},
		[actions, recentNames],
	);
	const setDefault = useCallback(
		(app: OpenInApp) => {
			void actions.settings.set("default_open_in", app.appName).then((result) => {
				if (!result.ok) toastError("Couldn't set the default app", result.error);
			});
		},
		[actions],
	);
	return { remember, setDefault };
}
