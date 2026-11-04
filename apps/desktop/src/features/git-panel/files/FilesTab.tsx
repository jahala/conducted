/**
 * @feature REV-06 All files tab
 * Owns: the All files tab body. A filter box over a virtualised tree of every file in the
 * workspace, with a row menu.
 * Behaviour: ui-map.md 3.6, "All files" paragraph. Quick open (Cmd+P) and search in files
 * (Cmd+Shift+F) are separate dialogs owned by the palette feature (REV-07).
 * Data: useFileTree(workspaceId), useActions().git.discardFile.
 * Children: FileTreeRow, FileRowMenu, files/file-tree-model.ts.
 * Must handle: loading and error states, an empty repository, thousands of files (windowed
 * rendering, folders loaded lazily by expanding), the tree changing underneath the user (agent
 * writes files, keep expanded folders and selection), a filter with no match, gitignored files
 * (hidden, as the file search does), symlinks (shown, not followed), and an archived workspace
 * (the worktree is gone: say so, do not list).
 * Test first: with entries ["src/a.ts", "README.md"] and the filter "read", only README.md shows.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export interface FilesTabProps {
	workspaceId: WorkspaceId;
	/** Opens the file in a file tab in edit or view mode. */
	onOpenFile: (path: string) => void;
}

export function FilesTab(_props: FilesTabProps): never {
	return notImplemented("REV-06");
}
