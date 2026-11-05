/**
 * @feature COMP-01 Send button
 * Owns: The send, queue or save button and the stop button next to it.
 * Behaviour: ui-map.md 3.4 (icon and tooltip switch between 'Send message', 'Queue message' and
 * 'Save edit'; test id composer-send-button), 3.5 (Stop button, tooltip 'Cancel',
 * Cmd+Shift+Backspace).
 * Our design choice: The send button is the screen's single accent button.
 * Must handle: Disabled with nothing to send; sending in progress (busy); agent working (queue or
 * steer label, per the follow-up setting) plus a Stop button; editing a queued message ('Save
 * edit'). Tooltips carry the shortcut from the command registry; the send shortcut follows the
 * send-key mode, so Cmd+Enter mode shows Cmd+Enter.
 * Test first: State 'queue' reads 'Queue message'; the Stop button appears only while working.
 */
import { formatShortcut, getCommand } from "../../core/registries/commands.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import type { SendWith } from "./send-key.ts";

export type SendButtonState = "send" | "queue" | "steer" | "save";

export interface SendButtonProps {
	state: SendButtonState;
	disabled: boolean;
	busy: boolean;
	working: boolean;
	onSend: () => void;
	onStop: () => void;
	/** The setting `message_send_key`, so the tooltip names the key that sends. */
	sendWith?: SendWith;
}

const labels: Record<SendButtonState, string> = {
	send: "Send message",
	queue: "Queue message",
	steer: "Send message",
	save: "Save edit",
};

const STOP_SHORTCUT = formatShortcut(
	getCommand("chat.cancelAgent")?.defaultShortcuts[0] ?? "Cmd+Shift+Backspace",
);

/** The submit binding: Enter by default, Cmd+Enter when the setting swaps the four chat bindings. */
function sendShortcut(sendWith: SendWith): string {
	const spec =
		sendWith === "mod_enter"
			? "Cmd+Enter"
			: (getCommand("chat.submit")?.defaultShortcuts[0] ?? "Enter");
	return formatShortcut(spec);
}

function SendIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M8 12.5V3.5M4.5 7L8 3.5 11.5 7" />
		</svg>
	);
}

function StopIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="currentColor"
			stroke="none"
			aria-hidden="true"
		>
			<rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
		</svg>
	);
}

export function SendButton({
	state,
	disabled,
	busy,
	working,
	onSend,
	onStop,
	sendWith = "enter",
}: SendButtonProps) {
	const label = labels[state];
	return (
		<div className="flex items-center gap-1">
			<IconButton
				size="xs"
				variant="default"
				label={label}
				shortcut={sendShortcut(sendWith)}
				icon={<SendIcon />}
				disabled={disabled}
				loading={busy}
				onClick={onSend}
				data-testid="composer-send-button"
			/>
			{working ? (
				<IconButton
					size="xs"
					variant="ghost"
					label="Cancel"
					shortcut={STOP_SHORTCUT}
					icon={<StopIcon />}
					onClick={onStop}
					data-testid="composer-stop-button"
				/>
			) : null}
		</div>
	);
}
