/**
 * @feature REV-09 Turn change summary
 * Owns: The list of files a turn changed, with line counts and an 'Open diff' action that opens the
 * Changes view scoped to this turn.
 * Behaviour: ui-map.md 3.3 (file-change summary with 'Open diff'), 3.3 checkpoint controls (diff
 * scope 'turn'), 3.6 (Changes list).
 * Must handle: No changes (renders nothing); many files (first few, then 'and N more'); a deleted
 * or renamed file; a binary file (no counts); the turn is reverted (list shown struck through);
 * opening a diff sets the URL scope to turn:<session>:<turn>.
 * Test first: A turn with 12 changed files shows the first 5 and 'and 7 more'.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { ChatTurn } from "../../core/model.ts";

export interface TurnChangesProps {
	turn: ChatTurn;
	sessionId: SessionId;
}

export function TurnChanges(_props: TurnChangesProps): never {
	return notImplemented("REV-09");
}
