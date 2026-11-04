/**
 * @feature COMP-07 Composer plus menu
 * Owns: The '+' menu: add attachment, link issue, link workspaces, plan mode, add snippet.
 * Behaviour: ui-map.md 3.5 ('+' menu: 'Link issue' (Cmd+I), 'Link workspaces', 'Plan mode' or 'Exit
 * plan mode' (Shift+Tab), 'Add attachment' (Cmd+U), 'Add snippet' (Cmd+;)), 3.10 (Link issue, Link
 * workspaces dialogs).
 * Our design choice: Link issue needs Linear (PR-09) and Add snippet is not in the scaffold
 * backlog: both are listed with a disabled state and the reason until built.
 * Must handle: Attachment picker cancelled; the agent does not support additional directories (Link
 * workspaces hidden); items show shortcuts from the command registry.
 * Test first: Choosing 'Add attachment' opens the file picker and adds the chosen paths to the
 * draft.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface PlusMenuProps {
	sessionId: SessionId;
}

export function PlusMenu(_props: PlusMenuProps): never {
	return notImplemented("COMP-07");
}
