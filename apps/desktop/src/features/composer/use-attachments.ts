/**
 * @feature COMP-07 Attachment handling
 * Owns: Adding attachments to a draft from the file picker, a drop and a paste: copy the file into
 * app storage, shrink large images, report failures.
 * Behaviour: ui-map.md 3.5 (attachments), native-and-sidecar-map.md A2 (attachments: copy dropped
 * files, shrink large images).
 * Our design choice: this hook is the one place that calls useActions().attachments.add.
 * Must handle: Drop of a folder (refused with a message); paste of an image from the clipboard; two
 * adds at once (both kept, in order); a failed copy (the others still succeed); the draft is saved
 * after each add.
 * Test first: Dropping two files adds two paths to the draft in order.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface AttachmentController {
	add: (files: File[]) => Promise<void>;
	pick: () => Promise<void>;
	remove: (path: string) => void;
	busy: boolean;
}

export function useAttachments(_props: SessionId): AttachmentController {
	return notImplemented("COMP-07");
}
