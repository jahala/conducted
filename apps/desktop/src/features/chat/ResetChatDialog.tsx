/**
 * @feature CHAT-15 Reset chat dialog
 * Owns: The confirmation to revert a chat to an earlier turn, with the option to restore files too.
 * Behaviour: ui-map.md 3.3 (Reset dialog: 'Reset chat?', 'Later messages will be deleted.',
 * checkbox 'Also reset files' with changed-file count, Cancel and Reset with Cmd+Enter), 3.3
 * checkpoint controls.
 * Must handle: Files option off (only the chat rewinds); files option on and the working tree has
 * other uncommitted changes (warn that they are kept or lost, per the checkpoint behaviour); the
 * revert fails (message in the dialog, chat unchanged); Cmd+Enter confirms; an agent that is
 * working (cancel first, then reset).
 * Test first: Confirming with 'Also reset files' ticked calls sessions.revertTo(id, turnId); the
 * dialog closes on success only.
 */

import type { SessionId, TurnId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ResetChatDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sessionId: SessionId;
	turnId: TurnId;
	changedFileCount: number;
}

export function ResetChatDialog(_props: ResetChatDialogProps): never {
	return notImplemented("CHAT-15");
}
