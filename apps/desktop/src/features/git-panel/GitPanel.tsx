/**
 * @feature REV-01 GitPanel
 * Owns: right panel, top half. A header (status chip and main action), a tab strip, and the
 * active tab: All files, Changes or Checks. Entry point embedded by the workspace screen.
 * Behaviour: ui-map.md 3.6 (tab strip, header, tabs); frontend layout in structure-map.md 3.2.
 * Data: useGitState, useWorkspaceStatus (agent working), useActions().
 * Children: GitHeader, GitPanelTabs, changes/ChangesTab, files/FilesTab, checks/ChecksTab.
 * The "Artifacts", "Desktop" and "Chat" tabs of Conductor are cloud or team features and are left
 * out.
 * The workspace URL state (workspace/workspace-search.ts) holds `gitTab`, `scope` and the open
 * file. The workspace screen passes them in through the optional props `tab`, `onTabChange`,
 * `scope`, `onScopeChange` and `onOpenFile`. A prop that is left out means the panel keeps that
 * value in its own state (and, without `onOpenFile`, cannot open a file tab).
 * Must handle: git state loading (skeleton header), git state error with retry, archived workspace
 * ("files are not available"), a workspace still initializing, no git status because a rebase or
 * merge is underway ("Finish rebasing or merging to see changes"), keyboard shortcuts for the
 * header actions only while the panel is mounted, and a workspace switch mid-request (only the
 * newest result may change state).
 * Test first: with a GitState of two uncommitted files the header reads "Uncommitted changes" and
 * the main action is "Commit and push".
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { DiffScope } from "../../core/api.ts";
import type { GitPanelTab } from "../../core/model.ts";

export interface GitPanelProps {
	workspaceId: WorkspaceId;
	tab?: GitPanelTab;
	onTabChange?: (tab: GitPanelTab) => void;
	scope?: DiffScope;
	onScopeChange?: (scope: DiffScope) => void;
	/** Opens a file in a center tab, as a diff or in the editor. */
	onOpenFile?: (path: string, mode: "diff" | "edit") => void;
}

export function GitPanel(_props: GitPanelProps): never {
	return notImplemented("REV-01");
}
