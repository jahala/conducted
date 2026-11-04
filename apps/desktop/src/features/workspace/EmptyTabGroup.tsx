/**
 * @feature NAV-10 Empty tab group
 * Owns: What the centre shows when no tab is open: three buttons to start one.
 * Behaviour: ui-map.md 3.2 ('Empty group: three buttons New chat, Browser, Local terminal'; 'No
 * open chats' with 'New chat'; for local workspaces a missing chat is created automatically).
 * Our design choice: 'New chat' is the one primary button. For a local workspace with no chat at
 * all, the first chat is created on open (the service decides), so this screen shows only after the
 * user closed every tab.
 * Must handle: Creating fails (toast, buttons return); the workspace is archived (the gate shows
 * the archived notice instead); the tab limit is reached.
 * Test first: Clicking 'New chat' calls sessions.create and sets tab=session with the new id in the
 * URL.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface EmptyTabGroupProps {
	workspaceId: WorkspaceId;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function EmptyTabGroup(_props: EmptyTabGroupProps): never {
	return notImplemented("NAV-10");
}
