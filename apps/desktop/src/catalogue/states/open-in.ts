/**
 * @feature catalogue States of the workspace header's Open in menu
 * Owns: the menu on two kinds of Mac (one with JetBrains' IDEs and the common editors, one with the
 * newer editors, several terminals and the git tools), and the toasts an open that fails shows: the
 * app was removed after the list was read, and the workspace folder is gone.
 * Behaviour: ui-map.md 3.10 ("Open in" app menu); features/open-in/open-in-apps.ts lists the apps
 * and names each failure.
 * Our design choice: each Mac lists only apps one developer plausibly has, so no state shows the
 * whole catalogue at once.
 * Test first: not applicable; the screenshot run opens every state.
 */
import { appError, err } from "@conducted/shared";
import { chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, shows } from "../dom.ts";
import { setSetting } from "../seeds.ts";
import type { CatalogueState, Scene } from "../state.ts";
import type { World } from "../world.ts";

/** A Mac with JetBrains' IDEs (the All Products Pack), the common editors and Apple's tools. */
const JETBRAINS_MAC = [
	"Finder",
	"Visual Studio Code",
	"Cursor",
	"IntelliJ IDEA",
	"PyCharm",
	"WebStorm",
	"PhpStorm",
	"GoLand",
	"RubyMine",
	"Rider",
	"DataGrip",
	"Android Studio",
	"Xcode",
	"Terminal",
	"iTerm",
	"GitHub Desktop",
];

/** A Mac with the newer editors, several terminals tried side by side and the git tools. */
const EDITORS_MAC = [
	"Finder",
	"Zed",
	"VSCodium",
	"Sublime Text",
	"Trae",
	"Antigravity",
	"Devin Desktop",
	"Ghostty",
	"Alacritty",
	"WezTerm",
	"Warp",
	"Hyper",
	"Sourcetree",
	"Fork",
	"Kaleidoscope",
];

/** The apps this Mac has, as the Rust shell would list them. */
function installApps(world: World, apps: readonly string[]): void {
	world.memory.platform.opener.installedApps = async () => [...apps];
}

/** arbor open, the Open in menu open, on a Mac with `apps`. */
const menuOn =
	(apps: readonly string[], lastApp: string) =>
	async (world: World): Promise<Scene> => {
		const cast = await seedCast(world);
		installApps(world, apps);
		await setSetting(world, "open_in_mru_order", lastApp);
		return {
			route: chatRoute(cast.arbor, cast.chats.arbor),
			after: async ({ app, document }) => {
				await refreshGit(app, cast.arbor);
				await click(document, "button", "Open in menu");
			},
			ready: (document) => shows(document, apps.at(-1) ?? "Finder"),
		};
	};

/** arbor open; opening it in Zed, the last used app, fails with `code`. */
const failedOpen =
	(code: "open_with_not_installed" | "open_with_missing_path", message: string, toast: string) =>
	async (world: World): Promise<Scene> => {
		const cast = await seedCast(world);
		installApps(world, ["Finder", "Zed", "Ghostty"]);
		await setSetting(world, "open_in_mru_order", "Zed");
		world.memory.platform.opener.openWith = async () => err(appError(code, message));
		return {
			route: chatRoute(cast.arbor, cast.chats.arbor),
			after: async ({ app, document }) => {
				await refreshGit(app, cast.arbor);
				await click(document, "button", "Open in Zed");
			},
			ready: (document) => shows(document, toast),
		};
	};

export const OPEN_IN_STATES: CatalogueState[] = [
	{
		id: "open-in-menu",
		group: "Workspace chat",
		title: "Open in menu on a Mac with JetBrains' IDEs and the common editors",
		seed: menuOn(JETBRAINS_MAC, "Cursor"),
	},
	{
		id: "open-in-menu-editors",
		group: "Workspace chat",
		title: "Open in menu on a Mac with the newer editors, several terminals and the git tools",
		seed: menuOn(EDITORS_MAC, "Zed"),
	},
	{
		id: "open-in-not-installed",
		group: "Workspace chat",
		title: "Open in Zed fails: Zed was removed after the menu was read (error)",
		seed: failedOpen(
			"open_with_not_installed",
			"Zed is not installed on this Mac.",
			"Failed to open editor",
		),
	},
	{
		id: "open-in-missing-folder",
		group: "Workspace chat",
		title: "Open in Zed fails: the workspace folder was removed outside the app (error)",
		seed: failedOpen(
			"open_with_missing_path",
			"The folder /Users/sam/conducted/workspaces/atlas/arbor does not exist.",
			"This app can't open this path",
		),
	},
];
