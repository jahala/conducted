/**
 * @feature SET-02 Shortcut recorder
 * Owns: the control that captures a key combination when the user presses it.
 * Behaviour: ui-map.md 5.4 (shortcuts use Cmd, Alt, Shift, Ctrl and a key) and 6.
 * Must handle: modifier-only presses (wait for a key), Escape cancelling, Backspace clearing, key
 * combinations that macOS or the app reserves (refused with the reason), international keyboard
 * layouts (record the key by its character, show the glyph the user sees), and focus returning to
 * the row after recording.
 * Test first: pressing Cmd+Shift+K calls onRecord with the combination "Cmd+Shift+K".
 */
import { notImplemented } from "@conducted/shared";

export interface ShortcutRecorderProps {
	onRecord: (combination: string) => void;
	onCancel: () => void;
}

export function ShortcutRecorder(_props: ShortcutRecorderProps): never {
	return notImplemented("SET-02");
}
