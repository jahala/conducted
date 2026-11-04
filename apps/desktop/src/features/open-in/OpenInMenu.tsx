/**
 * @feature WS-08 OpenInMenu
 * Owns: the "Open in" control in the workspace header: a button that opens the workspace folder in
 * the last used app, and a menu of the installed editors, terminals, git tools and Finder. Entry
 * point embedded by the workspace header.
 * Behaviour: ui-map.md 3.10 ("Open in" app menu; Cmd+O opens in the default app, Cmd+Shift+O opens
 * the menu); the order of recently used apps and the default app are settings (open_in_mru_order,
 * default_open_in in services-map.md 4.2.3).
 * Data: useWorkspace (path, archived), useSetting for the default and recent order,
 * useActions().workspaces.openIn(id, appName). Which apps are installed comes from useInstalledApps.
 * Children: OpenInButton, OpenInItem; open-in-apps.ts for the catalog and ordering.
 * Must handle: the installed-apps list loading (button works with Finder alone), no editor
 * installed (only Finder), the default app having been uninstalled (falls back to the first
 * available, visibly), an open that fails (toast with the app name), an archived workspace (folder
 * is gone: menu disabled with the reason), and Cmd+O when no default is set (opens the menu).
 * Test first: with Cursor and Finder installed and Cursor last used, the button label is Cursor
 * and the menu lists Cursor first.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function OpenInMenu(_props: { workspaceId: WorkspaceId }): never {
	return notImplemented("WS-08");
}
