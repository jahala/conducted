/**
 * @feature SET-02 Shortcut row
 * Owns: one command in the shortcuts list: title, category, the current shortcut as key caps, and
 * actions to change, clear or reset it.
 * Behaviour: ui-map.md 5.4 and 6 (Keyboard shortcuts page).
 * Must handle: an unbound command ("Not set"), a command changed from its default (marked, with
 * Reset), a disabled command (muted), a conflict flagged on the row, and the recorder open for this
 * row only.
 * Test first: an unbound command shows "Not set" and a Set action.
 */
import { notImplemented } from "@conducted/shared";
import type { CommandEntry } from "../../../core/api.ts";

export interface ShortcutRowProps {
	command: CommandEntry;
	changedFromDefault: boolean;
	conflictWith: string | null;
	recording: boolean;
	onStartRecording: () => void;
	onClear: () => void;
	onReset: () => void;
}

export function ShortcutRow(_props: ShortcutRowProps): never {
	return notImplemented("SET-02");
}
