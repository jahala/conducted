/**
 * @feature NAV-09 Keybinding editor
 * Owns: The control that records a new key combination for one command.
 * Behaviour: ui-map.md 5.4 (rebinding with conflict detection per scope; overrides stored under a
 * versioned key).
 * Must handle: Recording starts on click and stops on Escape without changing anything; a reserved
 * key (for example Cmd+Q, not rebindable) is refused with a reason; modifiers alone are not
 * accepted; the key is shown in macOS symbols and spoken as words.
 * Test first: Pressing Cmd+Shift+K while recording calls onChange('Cmd+Shift+K'); Escape cancels.
 */
import { notImplemented } from "@conducted/shared";

export interface KeybindingEditorProps {
	commandId: string;
	current: string | null;
	onChange: (keys: string | null) => void;
}

export function KeybindingEditor(_props: KeybindingEditorProps): never {
	return notImplemented("NAV-09");
}
