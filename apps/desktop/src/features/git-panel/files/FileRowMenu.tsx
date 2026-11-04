/**
 * @feature REV-06 File row menu
 * Owns: the context menu of a file row, shared by the All files tab and the Changes list.
 * Behaviour: ui-map.md 3.6, "All files" paragraph. Items: View, Attach in chat, Copy path, Copy
 * relative path, Discard changes.
 * Must handle: Discard changes shown only for changed files, with a confirm step because it cannot
 * be undone; Attach in chat needing an active chat (disabled with a reason when there is none);
 * folders (View and Discard not offered); and a menu opened on an archived workspace (only the copy
 * items work).
 * Test first: for an unchanged file the menu has no "Discard changes" item.
 */
import { notImplemented } from "@conducted/shared";

export interface FileRowMenuProps {
	path: string;
	isDirectory: boolean;
	changed: boolean;
	hasActiveChat: boolean;
	onView: () => void;
	onAttachInChat: () => void;
	onCopyPath: (kind: "absolute" | "relative") => void;
	onDiscard: () => void;
}

export function FileRowMenu(_props: FileRowMenuProps): never {
	return notImplemented("REV-06");
}
