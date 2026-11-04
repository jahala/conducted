/**
 * @feature REV-01 Changed file list
 * Owns: the virtualised list of changed files, in flat or folder form. It renders rows and folder
 * rows from the model built by changed-file-tree.ts and tracks which row is selected.
 * Behaviour: ui-map.md 3.6, Changes paragraph (status, +/- lines, Viewed checkbox, conflict badge).
 * Must handle: thousands of files (windowed rendering), a selection that survives list updates
 * while the same path exists, keyboard selection with arrows, folders collapsing and expanding
 * (state kept per workspace), and focus returning to the list after a row menu closes.
 * Test first: with 5,000 files only the visible window of rows is in the DOM.
 */
import { notImplemented } from "@conducted/shared";
import type { ChangedTreeNode } from "./changed-file-tree.ts";

export interface ChangedFileListProps {
	nodes: ChangedTreeNode[];
	selectedPath: string | null;
	onSelect: (path: string) => void;
	onOpen: (path: string) => void;
	onToggleViewed: (path: string, viewed: boolean) => void;
	onToggleFolder: (folderPath: string) => void;
	collapsedFolders: ReadonlySet<string>;
}

export function ChangedFileList(_props: ChangedFileListProps): never {
	return notImplemented("REV-01");
}
