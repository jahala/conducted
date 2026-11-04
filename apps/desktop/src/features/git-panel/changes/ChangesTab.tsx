/**
 * @feature REV-01 Changes tab
 * Owns: the Changes tab body. The toolbar (filter, flat or folder view, diff scope), the changed
 * file list, and the empty states. Clicking a file opens a file tab in diff mode.
 * Behaviour: ui-map.md 3.6, "Changes" paragraph; services-map.md 3.3 (what the list is made of)
 * and 3.4.1 (the diff scopes).
 * Data: useChangedFiles(workspaceId, scope), useGitState (conflicts, rebase underway),
 * useActions().git.setViewed and discardFile.
 * Children: ChangesToolbar, ScopeBackBar, ChangedFileList, ChangesEmpty, StackView.
 * Keyboard: ArrowUp and ArrowDown move the selected file, Cmd+Alt+J and Cmd+Alt+K move between
 * comments, Cmd+Shift+D opens the selected file's diff (ui-map.md 3.6).
 * Must handle: loading (skeleton rows), error with retry, no git status (rebase or merge
 * underway), no changes, a filter that matches nothing, untracked files cut off at the cap, a very
 * long list (virtualised), a file that is viewed and then changes again (the viewed mark resets),
 * conflicted files first, archived workspace, and a scope change while a request is in flight (only
 * the newest answer may update the list).
 * Test first: with three ChangedFile rows and the filter "src/a", only the matching row renders.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { DiffScope } from "../../../core/api.ts";

export interface ChangesTabProps {
	workspaceId: WorkspaceId;
	scope: DiffScope;
	onScopeChange: (scope: DiffScope) => void;
	/** Opens a file tab in diff mode for the file, using the current scope. */
	onOpenFile: (path: string) => void;
}

export function ChangesTab(_props: ChangesTabProps): never {
	return notImplemented("REV-01");
}
