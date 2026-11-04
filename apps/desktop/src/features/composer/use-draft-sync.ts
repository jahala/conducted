/**
 * @feature COMP-01 Draft sync
 * Owns: Saving the editor's text and attachments as the draft after a short pause, and restoring
 * them when a chat opens.
 * Behaviour: ui-map.md 3.5 (draft per session kept in a store), frontend.md 4 (drafts live in local
 * storage and survive restarts).
 * Our design choice: Saves through sessions.saveDraft, which is synchronous from the screen's side.
 * Restores the draft once per chat, then the editor is the source of truth.
 * Must handle: Switching chats before the pause ends (save the old chat's draft first); a send
 * clears the draft; an empty editor removes the draft; a draft for a closed chat is cleaned up by
 * the data-lifetime job.
 * Test first: Typing then switching chats saves the first chat's text once and restores the second
 * chat's draft.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Editor } from "@tiptap/react";

export function useDraftSync(_props: { sessionId: SessionId; editor: Editor | null }): void {
	notImplemented("COMP-01");
}
