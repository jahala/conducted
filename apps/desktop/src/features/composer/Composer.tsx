/**
 * @feature COMP-01 Composer
 * Owns: The message box at the bottom of a chat: editor, toolbar (plus menu, model picker, mode
 * chips, context wheel, dictation) and the send or stop button.
 * Behaviour: ui-map.md 3.5 (Composer: TipTap editor, placeholder, toolbar, send or queue or save
 * button, stop button), 3.4 (send button icon and tooltip switch between 'Send message', 'Queue
 * message' and 'Save edit').
 * Our design choice: Narrow layouts move toolbar items into one 'More composer actions' menu. The
 * composer can minimise while a file or diff tab is open, so the content gets the room. The accent
 * colour is used once here: the send button.
 * Must handle: Archived or read-only workspace (ArchivedComposerBar instead); agent working (send
 * becomes queue or steer, a stop button appears); draft restored when the app restarts; empty text
 * (send disabled); attachments only (send enabled); the sidecar is down (message kept, error shown,
 * nothing lost); focus returns to the editor after sending; Cmd+L focuses the editor.
 * Test first: With text typed and the agent idle, the send button is enabled; while the agent works
 * it reads 'Queue message' and a Cancel button shows.
 */

import type { SessionId, WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface ComposerProps {
	workspaceId: WorkspaceId;
	sessionId: SessionId;
}

export function Composer(_props: ComposerProps): never {
	return notImplemented("COMP-01");
}
