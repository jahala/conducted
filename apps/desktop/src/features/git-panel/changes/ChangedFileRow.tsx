/**
 * @feature REV-01 Changed file row
 * Owns: one file in the Changes list. File icon, name and folder, status letter, added and removed
 * line counts, a conflict badge, and the Viewed checkbox.
 * Behaviour: ui-map.md 3.6, Changes paragraph. Viewed checkbox shortcut `Ctrl+V`. Row menu:
 * "Copy path", "Copy relative path", "Discard changes".
 * Must handle: renamed files (show old path and new path), binary files (no line counts, a
 * "binary" tag), conflicted files, a deleted file (no preview), a long path (middle truncation),
 * discard asking for confirmation because it cannot be undone, and the checkbox not opening the
 * file.
 * Test first: clicking the Viewed checkbox calls onToggleViewed and does not call onOpen.
 */
import { notImplemented } from "@conducted/shared";
import type { ChangedFile } from "../../../core/api.ts";

export interface ChangedFileRowProps {
	file: ChangedFile;
	/** Indent level in folder view, 0 in flat view. */
	depth: number;
	selected: boolean;
	onOpen: () => void;
	onToggleViewed: (viewed: boolean) => void;
	onDiscard: () => void;
	onCopyPath: (kind: "absolute" | "relative") => void;
}

export function ChangedFileRow(_props: ChangedFileRowProps): never {
	return notImplemented("REV-01");
}
