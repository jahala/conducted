/**
 * @feature NAV-10 Workspace header
 * Owns: The header at the top of the centre: breadcrumb (repo, branch, target branch), workspace
 * name with rename and actions, the Open in menu, and the right panel toggle.
 * Behaviour: ui-map.md 3.1 (breadcrumb with target branch picker, workspace name with 'Rename
 * workspace' and 'Workspace actions', directory chip and 'Open in...' button, PR and git buttons
 * move into the header when the right panel is closed, right edge 'Toggle right sidebar'), 5.3
 * (branch name menu: Copy, Rename).
 * Our design choice: Follow, avatars and cloud status are cloud features and are left out. The Open
 * in menu is OpenInMenu from features/open-in. The header starts with <TitleBarInset> and is a
 * window drag region.
 * Must handle: Loading and error (small inline states, the rest of the screen stays); placeholder
 * branch name (shown muted until the first message renames it); detached or missing target branch;
 * right panel closed (show the main git action here); a long name truncates; archived workspace (no
 * Open in, no git actions).
 * Test first: Renders the workspace name and the Open in menu; the toggle button reflects
 * rightPanelOpen.
 */

import type { RepoId, WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { RightPanelControls } from "./WorkspaceLayout.tsx";

export interface WorkspaceHeaderProps {
	repoId: RepoId;
	workspaceId: WorkspaceId;
	controls: RightPanelControls;
}

export function WorkspaceHeader(_props: WorkspaceHeaderProps): never {
	return notImplemented("NAV-10");
}
