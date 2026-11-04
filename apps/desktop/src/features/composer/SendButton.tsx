/**
 * @feature COMP-01 Send button
 * Owns: The send, queue or save button and the stop button next to it.
 * Behaviour: ui-map.md 3.4 (icon and tooltip switch between 'Send message', 'Queue message' and
 * 'Save edit'; test id composer-send-button), 3.5 (Stop button, tooltip 'Cancel',
 * Cmd+Shift+Backspace).
 * Our design choice: The send button is the screen's single accent button.
 * Must handle: Disabled with nothing to send; sending in progress (busy); agent working (queue or
 * steer label, per the follow-up setting) plus a Stop button; editing a queued message ('Save
 * edit'); tooltips carry the shortcut from the command registry.
 * Test first: State 'queue' reads 'Queue message'; the Stop button appears only while working.
 */
import { notImplemented } from "@conducted/shared";

export type SendButtonState = "send" | "queue" | "steer" | "save";

export interface SendButtonProps {
	state: SendButtonState;
	disabled: boolean;
	busy: boolean;
	working: boolean;
	onSend: () => void;
	onStop: () => void;
}

export function SendButton(_props: SendButtonProps): never {
	return notImplemented("COMP-01");
}
