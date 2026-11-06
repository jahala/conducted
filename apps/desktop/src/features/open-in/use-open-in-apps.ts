/**
 * @feature WS-08 Open a workspace in another app
 * Owns: the apps the "Open in" menu lists and the one it opens by default, read by the menu and by
 * the file tab's "Open in another app" (REV-08), so both choose the same app.
 * Behaviour: ui-map.md 3.10; services-map.md 4.2.3 (`default_open_in`, `open_in_mru_order`).
 * Must handle: the installed-apps list loading or failing (Finder alone is listed), a stored default
 * that is not installed (the first listed app is used).
 * Test first: with no stored default, the file tab opens a file in the first listed app.
 */
import { useMemo } from "react";
import { useInstalledApps, useSetting } from "../../core/hooks.ts";
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
