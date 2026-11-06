/**
 * @feature COMP-01 Composer editor
 * Owns: how the composer's send key learns that a trigger menu ('@', '/', '#', '§') is open, so Enter and
 * Tab go to the menu instead of sending the message.
 * Behaviour: ui-map.md 3.5 (the triggers' menus choose a row with Enter), 5.4 (Enter sends).
 * Our design choice: a trigger plugin says so in its own spec (`triggerMenuOpen`), so the editor
 * needs no list of triggers. The send key runs before ProseMirror sees the key, so without this
 * Enter on an open menu sent the message.
 * Must handle: no trigger plugin loaded (never open); a plugin without the field (ignored).
 * Test first: with the '#' menu open, Enter in the composer chooses the row and sends nothing.
 */
import type { EditorState } from "@tiptap/pm/state";

/** The field a trigger plugin adds to its spec. */
export interface TriggerMenuSpec {
	triggerMenuOpen: (state: EditorState) => boolean;
}

/** True while any loaded trigger plugin's menu is open. */
export function triggerMenuOpen(state: EditorState): boolean {
	return state.plugins.some(
		(plugin) => (plugin.spec as Partial<TriggerMenuSpec>).triggerMenuOpen?.(state) === true,
	);
}
