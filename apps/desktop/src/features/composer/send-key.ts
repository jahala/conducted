/**
 * @feature COMP-01 Send key
 * Owns: deciding what a key press means in the message editor: send, send the other way (queue instead of steer
 * or the reverse), or a new line.
 * Behaviour: ui-map.md 5.4 (Chat: "Enter (default) or Cmd+Enter" submits; "Cmd+Enter (default) or Alt+Enter"
 * submits with the opposite follow-up behaviour; "Shift+Enter (default mode) or Enter (Cmd+Enter mode)" is a
 * new line), 3.4 (setting "Send messages with": Enter or Cmd+Enter).
 * Must handle: text composition in progress (an IME confirming a character must not send); any other
 * combination returns null so the editor handles it; Shift+Enter is a new line in both modes; Ctrl+Enter is
 * not bound.
 * Test first: in "enter" mode Enter sends and Shift+Enter is a new line; in "mod_enter" mode Cmd+Enter sends and
 * Enter is a new line.
 */
export type SendWith = "enter" | "mod_enter";
export type SendIntent = "submit" | "submit_opposite" | "newline";

/** The parts of a keyboard event that matter here, so the function stays pure. */
export interface KeyPress {
	key: string;
	shiftKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	isComposing: boolean;
}

export function resolveSendKey(press: KeyPress, sendWith: SendWith): SendIntent | null {
	if (press.key !== "Enter" || press.isComposing || press.ctrlKey) return null;
	const { shiftKey, metaKey, altKey } = press;
	if (sendWith === "enter") {
		if (!shiftKey && !metaKey && !altKey) return "submit";
		if (shiftKey && !metaKey && !altKey) return "newline";
		if (metaKey && !shiftKey && !altKey) return "submit_opposite";
		return null;
	}
	if (metaKey && !shiftKey && !altKey) return "submit";
	if (altKey && !shiftKey && !metaKey) return "submit_opposite";
	if (!metaKey && !altKey) return "newline";
	return null;
}
