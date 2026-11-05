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
import { useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Textarea } from "../../ui/Input.tsx";

export interface ReviewPromptDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSend: (extraInstructions: string | null) => void;
}

export function ReviewPromptDialog({ open, onOpenChange, onSend }: ReviewPromptDialogProps) {
	const [text, setText] = useState("");

	const send = () => {
		const trimmed = text.trim();
		onSend(trimmed.length === 0 ? null : trimmed);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Edit before sending"
				description="Add instructions for the review. Leave it empty to use the prompt as it is."
				onConfirm={send}
			>
				<Textarea
					value={text}
					onChange={(event) => setText(event.target.value)}
					placeholder="Extra instructions for the review"
					aria-label="Extra instructions"
					rows={6}
				/>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={send}>Send</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
