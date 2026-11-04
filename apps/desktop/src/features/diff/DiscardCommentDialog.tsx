/**
 * @feature REV-03 Discard comment dialog
 * Owns: the confirm dialog shown when the user cancels a comment that has text.
 * Behaviour: ui-map.md 3.6 ("Discard comment?" dialog, buttons Keep editing and Discard).
 * Must handle: Escape meaning Keep editing, focus returning to the composer after Keep editing,
 * and Enter on Discard being a deliberate second key press (not the one that opened the dialog).
 * Test first: pressing Discard calls onDiscard once and Keep editing calls onKeep.
 */
import { notImplemented } from "@conducted/shared";

export interface DiscardCommentDialogProps {
	open: boolean;
	onKeep: () => void;
	onDiscard: () => void;
}

export function DiscardCommentDialog(_props: DiscardCommentDialogProps): never {
	return notImplemented("REV-03");
}
