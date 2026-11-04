/**
 * @feature WS-08 Open-in app catalog
 * Owns: the list of apps the menu knows how to open a folder with, and the pure function that
 * picks and orders the ones to show.
 * Behaviour: ui-map.md 3.10. The apps Conductor lists: Finder; editors Cursor, VS Code, Zed (with
 * Preview and Nightly builds), VSCodium, Sublime Text, Trae, Antigravity and Devin Desktop; JetBrains
 * IDEs (PyCharm, IntelliJ IDEA in several editions, Android Studio, Rider, RubyMine, WebStorm,
 * PhpStorm, GoLand, DataGrip); Xcode; terminals Ghostty, Alacritty, iTerm, WezTerm, Warp, Hyper and
 * Terminal; git tools GitHub Desktop, Sourcetree, Fork and Kaleidoscope.
 * The catalog entries must carry the exact application name that Platform.opener.openWith expects
 * (the macOS app name). Those names are not verified here, so the catalog is a placeholder: the
 * builder checks each name against `open -Ra` on a Mac before filling it in.
 * Order of the menu: recently used first (most recent first), then the rest by category (editors,
 * IDEs, terminals, git tools) and name. Finder is always present. This order is Our design choice.
 * Must handle: an installed app that is not in the catalog (not shown), a catalog app that is not
 * installed (hidden), an empty recent list, duplicate names in the recent list, and a recent app
 * that is no longer installed (dropped).
 * Test first: visibleOpenInApps with installed ["Finder", "Cursor", "Zed"] and recent ["Zed"] puts
 * Zed first and omits every other catalog app.
 */
import { notImplemented } from "@conducted/shared";

export type OpenInCategory = "finder" | "editor" | "ide" | "terminal" | "git_tool";

export interface OpenInApp {
	/** The macOS application name passed to Platform.opener.openWith. */
	appName: string;
	label: string;
	category: OpenInCategory;
}

export function openInCatalog(): readonly OpenInApp[] {
	return notImplemented("WS-08");
}

export function visibleOpenInApps(
	_catalog: readonly OpenInApp[],
	_installedAppNames: readonly string[],
	_recentAppNames: readonly string[],
): OpenInApp[] {
	return notImplemented("WS-08");
}
