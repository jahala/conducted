/**
 * @feature NAV-14 Which dialogs hold app shortcuts
 * Owns: the mark a dialog carries when app shortcuts keep running under it:
 * `LETS_SHORTCUTS_THROUGH` and `letShortcutsThroughProps`.
 * Behaviour: ui-map.md 5.4 ("Which dialogs hold app shortcuts"). Conductor's key listener holds
 * app shortcuts while its dialog store has an active dialog id (renderApp @681094). Only the
 * dialogs that go through that store set one; the rest let app shortcuts through.
 * Our design choice: a dialog holds app shortcuts unless it carries this mark, because most of
 * Conductor's dialogs go through its store. The command dispatcher reads the mark.
 * Test first: keeps app shortcuts working under a dialog that lets them through.
 */

/** The attribute on a dialog's content that lets app shortcuts through. */
export const LETS_SHORTCUTS_THROUGH = "data-lets-shortcuts-through";

/** The props a dialog's content spreads: the mark when it lets app shortcuts through. */
export function letShortcutsThroughProps(lets: boolean): Record<string, string> {
	return lets ? { [LETS_SHORTCUTS_THROUGH]: "" } : {};
}
