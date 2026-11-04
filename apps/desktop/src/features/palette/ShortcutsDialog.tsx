/**
 * @feature NAV-09 Shortcuts dialog
 * Owns: The dialog that lists every shortcut by category, with a search box, and lets the user
 * rebind them.
 * Behaviour: ui-map.md 5.4 (176 entries with id, key, configurable, category, optional when;
 * categories General, View, Navigation, Workspace, Chat, Code review, Terminal; overrides persist;
 * search box 'Search shortcuts...'), 5.2 (dialog 'Keyboard shortcuts').
 * Our design choice: Rows come from the command registry (useCommands), so the dialog, menus,
 * tooltips and palette always agree. Video-player keys and hidden contextual keys are not listed.
 * Must handle: Search with no match; a command that cannot be rebound (shown without the edit
 * control); a key already used in the same scope (conflict warning with both names, the user
 * decides); reset one or all; the user's send-key mode swaps the four Enter bindings and the dialog
 * shows the current ones.
 * Test first: Searching 'sidebar' lists the two sidebar toggles; a conflicting binding shows a
 * warning naming the other command.
 */
import { notImplemented } from "@conducted/shared";
import type { OverlayProps } from "../../ui/overlay-props.ts";

export function ShortcutsDialog(_props: OverlayProps): never {
	return notImplemented("NAV-09");
}
