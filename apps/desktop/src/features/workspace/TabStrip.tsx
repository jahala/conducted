/**
 * @feature NAV-10 Tab strip
 * Owns: The row of tabs above the content: chats, terminals, files, review comments, the PR and
 * browser previews, with the '+' menu and chat history.
 * Behaviour: ui-map.md 3.2 (tab types with icon and close button; middle click closes; chat tab
 * fixed width with status icon, title and unread dot; '+' menu 'New chat', 'Browser', 'Local
 * terminal'; the tab limit; 'View chat history').
 * Our design choice: The tab limit is a setting; the default is not verified (ui-map.md 10) and
 * must be chosen when the setting is built. Tabs scroll sideways when they do not fit. The cloud
 * desktop tab is left out.
 * Must handle: Many tabs (scroll, keep the active tab in view); at the tab limit (new-tab buttons
 * disabled with a reason); closing the active tab opens its neighbour; closing the last chat (a new
 * chat is created for local workspaces); error card 'Tabs failed to load' with Retry; archived
 * workspace (no tabs); reopen closed tab.
 * Test first: Closing the active middle tab selects the tab to its right; at the limit the '+' menu
 * is disabled.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface TabStripProps {
	workspaceId: WorkspaceId;
	search: WorkspaceSearch;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function TabStrip(_props: TabStripProps): never {
	return notImplemented("NAV-10");
}
