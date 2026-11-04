/**
 * @feature NAV-03 Workspace row
 * Owns: One row of the sidebar list: status icon, name, repo avatar, line change counts, unread
 * dot, relative time, status text and badges.
 * Behaviour: ui-map.md 4 (workspace row: name from the user-set name, PR title, branch or
 * directory; badges Draft and Archive workspace; Cmd+1..9 switch; hover keys R read and P pin), 3.8
 * (status text).
 * Our design choice: The row is a link to the workspace route. Its context menu is the shared
 * Workspace actions menu from features/workspace. Status words come from status-text.ts.
 * Must handle: A long name truncates; selected row is marked by background, not accent; unread dot
 * only when there are unread chats; no status yet (hook returns null); hover shows the pin and read
 * keys; keyboard focus ring; a failed workspace shows its failure text in the danger colour; drag
 * handle source for sections (use-workspace-drag.ts).
 * Test first: A workspace with a PR title and no display name shows the PR title; an unread count
 * above zero shows the unread dot.
 */
import { notImplemented } from "@conducted/shared";
import type { Repo, Workspace } from "../../core/model.ts";

export interface WorkspaceRowProps {
	workspace: Workspace;
	repo: Repo;
	selected: boolean;
	/** 1 to 9 for the first nine rows, which have a Cmd+number shortcut. */
	shortcutIndex: number | null;
}

export function WorkspaceRow(_props: WorkspaceRowProps): never {
	return notImplemented("NAV-03");
}
