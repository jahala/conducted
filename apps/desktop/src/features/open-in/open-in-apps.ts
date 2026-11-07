/**
 * @feature WS-08 Open-in app catalog
 * Owns: the list of apps the menu knows how to open a folder with, the pure function that picks
 * and orders the ones to show, and the toast title for an open that failed.
 * Behaviour: ui-map.md 3.10. The labels are the ones the Rust shell detects and accepts
 * (PLAT-19), so an installed app always has a matching catalog row.
 * Order of the menu: recently used first (most recent first), then the rest by category (Finder,
 * editors, IDEs, terminals, git tools) and label. Finder is always present. This order is Our
 * design choice.
 * Must handle: an installed app that is not in the catalog (not shown), a catalog app that is not
 * installed (hidden), an empty recent list, duplicate names in the recent list, and a recent app
 * that is no longer installed (dropped).
 * Test first: visibleOpenInApps with installed ["Finder", "Cursor", "Zed"] and recent ["Zed"] puts
 * Zed first and omits every other catalog app.
 */
import type { AppError } from "@conducted/shared";

export type OpenInCategory = "finder" | "editor" | "ide" | "terminal" | "git_tool";

export interface OpenInApp {
	/** The macOS application label passed to Platform.opener.openWith. */
	appName: string;
	label: string;
	category: OpenInCategory;
}

const CATALOG: readonly OpenInApp[] = [
	{ appName: "Finder", label: "Finder", category: "finder" },
	{ appName: "Cursor", label: "Cursor", category: "editor" },
	{ appName: "Visual Studio Code", label: "Visual Studio Code", category: "editor" },
	{ appName: "Zed", label: "Zed", category: "editor" },
	{ appName: "VSCodium", label: "VSCodium", category: "editor" },
	{ appName: "Sublime Text", label: "Sublime Text", category: "editor" },
	{ appName: "PyCharm", label: "PyCharm", category: "ide" },
	{ appName: "IntelliJ IDEA", label: "IntelliJ IDEA", category: "ide" },
	{ appName: "Android Studio", label: "Android Studio", category: "ide" },
	{ appName: "Xcode", label: "Xcode", category: "ide" },
	{ appName: "Rider", label: "Rider", category: "ide" },
	{ appName: "RubyMine", label: "RubyMine", category: "ide" },
	{ appName: "WebStorm", label: "WebStorm", category: "ide" },
	{ appName: "PhpStorm", label: "PhpStorm", category: "ide" },
	{ appName: "GoLand", label: "GoLand", category: "ide" },
	{ appName: "DataGrip", label: "DataGrip", category: "ide" },
	{ appName: "Trae", label: "Trae", category: "editor" },
	{ appName: "Antigravity", label: "Antigravity", category: "editor" },
	{ appName: "Ghostty", label: "Ghostty", category: "terminal" },
	{ appName: "Alacritty", label: "Alacritty", category: "terminal" },
	{ appName: "iTerm", label: "iTerm", category: "terminal" },
	{ appName: "WezTerm", label: "WezTerm", category: "terminal" },
	{ appName: "Warp", label: "Warp", category: "terminal" },
	{ appName: "Hyper", label: "Hyper", category: "terminal" },
	{ appName: "Terminal", label: "Terminal", category: "terminal" },
	{ appName: "GitHub Desktop", label: "GitHub Desktop", category: "git_tool" },
	{ appName: "Sourcetree", label: "Sourcetree", category: "git_tool" },
	{ appName: "Fork", label: "Fork", category: "git_tool" },
	{ appName: "Kaleidoscope", label: "Kaleidoscope", category: "git_tool" },
	{ appName: "Devin Desktop", label: "Devin Desktop", category: "editor" },
];

const CATEGORY_ORDER: Record<OpenInCategory, number> = {
	finder: 0,
	editor: 1,
	ide: 2,
	terminal: 3,
	git_tool: 4,
};

export function openInCatalog(): readonly OpenInApp[] {
	return CATALOG;
}

/**
 * The apps Conductor opens a cloud workspace in over SSH (CLOUD-12). A cloud workspace has no
 * folder on this Mac, so Finder and the other editors are not offered.
 */
export const REMOTE_OPEN_APP_NAMES: readonly string[] = ["Cursor", "Visual Studio Code", "Zed"];

/** The installed apps that can open a cloud workspace remotely. */
export function remoteOpenInApps(apps: readonly OpenInApp[]): OpenInApp[] {
	return apps.filter((app) => REMOTE_OPEN_APP_NAMES.includes(app.appName));
}

export function visibleOpenInApps(
	catalog: readonly OpenInApp[],
	installedAppNames: readonly string[],
	recentAppNames: readonly string[],
): OpenInApp[] {
	const installed = new Set(installedAppNames);
	const byName = new Map<string, OpenInApp>();
	for (const app of catalog) {
		if (app.category === "finder" || installed.has(app.appName)) byName.set(app.appName, app);
	}

	const recent: OpenInApp[] = [];
	const seen = new Set<string>();
	for (const name of recentAppNames) {
		if (seen.has(name)) continue;
		seen.add(name);
		const app = byName.get(name);
		if (app !== undefined) recent.push(app);
	}

	const rest = [...byName.values()]
		.filter((app) => !seen.has(app.appName))
		.sort(
			(left, right) =>
				CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category] ||
				left.label.localeCompare(right.label),
		);

	return [...recent, ...rest];
}

/** The toast title Conductor shows for an open that failed. */
/**
 * The app "Open in" uses: the stored default when it is in the list (installed on this Mac), else the
 * first app of the list. Conductor's rule (renderApp `pe = B && fe.some(...) ? B : fe[0]?.id`); only an
 * empty list has no app.
 */
export function defaultOpenInApp(
	apps: readonly OpenInApp[],
	storedDefault: string,
): OpenInApp | null {
	return apps.find((app) => app.appName === storedDefault) ?? apps[0] ?? null;
}

export function openInFailureTitle(error: AppError): string {
	switch (error.code) {
		case "open_with_missing_path":
		case "open_with_unknown_app":
			return "This app can't open this path";
		case "open_with_not_installed":
			return "Failed to open editor";
		case "open_in_prepare_failed":
			return "Failed to prepare file to open";
		case "open_in_no_default_app":
			return "No default app configured";
		case "remote_open_unsupported":
			return "Couldn't open the cloud workspace";
		case "remote_open_failed":
			return "Failed to open editor";
		default:
			return "Failed to open the workspace";
	}
}
