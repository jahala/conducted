/**
 * @feature REV-08 File diff pane
 * Owns: the diff mode of the File tab. It loads the file's diff and comments through hooks and
 * hands them to DiffView.
 * Behaviour: ui-map.md 3.2 (File tab, diff mode); services-map.md 3.4 (diff sources per scope).
 * Data: useFileDiff, useDiffComments, useActions().comments, useActions().git.setViewed.
 * Children: diff/DiffView, diff/DiffWarning, FileTabState (loading and error).
 * Must handle: loading, error with retry, an unchanged file in this scope ("No changes in this
 * scope"), the diff reloading while the agent writes (keep the old diff on screen with an
 * "Updating diff" notice, never blank it), a viewed mark resetting when the file changes, and
 * conflicted files (shows the conflict markers as plain text with a notice).
 * Test first: while a second request is in flight the previous diff stays rendered.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { DiffScope } from "../../core/api.ts";
import type { DiffPreferences } from "../diff/diff-types.ts";

export interface FileDiffPaneProps {
	workspaceId: WorkspaceId;
	path: string;
	scope: DiffScope;
	preferences: DiffPreferences;
}

export function FileDiffPane(_props: FileDiffPaneProps): never {
	return notImplemented("REV-08");
}
