/**
 * @feature COMP-07 Attachment bar
 * Owns: The row of attachment thumbnails and file chips above the editor, each removable.
 * Behaviour: ui-map.md 3.5 (attachments: file picker, drag and drop, paste; images over 5MB fail;
 * 'Paste copied files as paths' Cmd+Shift+V), 3.3 ('Image too large').
 * Must handle: No attachments (renders nothing); an image over the limit (error chip naming the
 * limit); a file that disappeared; copying a large file in progress (busy chip); many attachments
 * (wrap, then scroll); remove by keyboard.
 * Test first: Two attachments render two removable items; removing one updates the draft.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface AttachmentBarProps {
	sessionId: SessionId;
}

export function AttachmentBar(_props: AttachmentBarProps): never {
	return notImplemented("COMP-07");
}
