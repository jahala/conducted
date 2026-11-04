/**
 * @feature REV-01 Review prompt dialog
 * Owns: the small dialog opened by "Edit before sending". The user adds extra instructions to the
 * review request, then sends it.
 * Behaviour: ui-map.md 3.6 (Review button, split item "Edit before sending"). The base prompt
 * comes from the repository's review prompt setting; this dialog only adds to it.
 * Must handle: empty text (send is allowed, it means no extra instructions), Escape to cancel
 * without sending, Cmd+Enter to send, and a send that fails (dialog stays open with the error
 * and the typed text intact).
 * Test first: submitting with text calls onSend with that text, and submitting empty calls it
 * with null.
 */
import { notImplemented } from "@conducted/shared";

export interface ReviewPromptDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSend: (extraInstructions: string | null) => void;
}

export function ReviewPromptDialog(_props: ReviewPromptDialogProps): never {
	return notImplemented("REV-01");
}
