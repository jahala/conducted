/**
 * @feature NAV-10 New tab menu
 * Owns: The '+' button and its menu: New chat (or New chat, same files), Browser, Local terminal.
 * Behaviour: ui-map.md 3.2 ('+' new tab menu, Cmd+T; buttons disable at the tab limit).
 * Must handle: At the tab limit (items disabled, tooltip says why); creating fails (toast with the
 * message); the new tab becomes active; the browser item asks for a URL or uses the preview URL
 * when a run action has one.
 * Test first: Choosing 'Local terminal' calls terminals.create and sets the terminal tab in the
 * URL.
 */

import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { WorkspaceSearch } from "./workspace-search.ts";

export interface NewTabMenuProps {
	workspaceId: WorkspaceId;
	atTabLimit: boolean;
	onSearchChange: (patch: Partial<WorkspaceSearch>) => void;
}

export function NewTabMenu(_props: NewTabMenuProps): never {
	return notImplemented("NAV-10");
}
