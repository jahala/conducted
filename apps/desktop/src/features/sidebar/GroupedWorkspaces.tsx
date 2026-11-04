/**
 * @feature NAV-03 Grouped workspace list
 * Owns: Showing the sidebar's workspaces in groups: Pinned, the user's sections, then the main list
 * grouped by status or by project.
 * Behaviour: ui-map.md 4 items 4 to 7 and the View options menu (group by Status or Project, filter
 * by project, sort by Updated or Created).
 * Our design choice: The view options (group, filter, sort) are kept in a setting so they survive a
 * restart. Status groups run in this order: done, in review, in progress, backlog, canceled, the
 * order Conductor uses.
 * Must handle: A workspace in two places (pinned and in a section) shows once, in Pinned; a group
 * with no workspaces is hidden; a collapsed group shows its count; a project filter that matches
 * nothing shows a short empty note with a way to clear it; archived workspaces are never listed;
 * the selected workspace stays visible after a re-sort.
 * Test first: Given three workspaces in two repos, grouping by project gives two groups; pinning
 * one moves it to Pinned and removes it from its group.
 */
import { notImplemented } from "@conducted/shared";
import type { Repo, Workspace } from "../../core/model.ts";

export interface GroupedWorkspacesProps {
	repos: Repo[];
	workspaces: Workspace[];
}

export function GroupedWorkspaces(_props: GroupedWorkspacesProps): never {
	return notImplemented("NAV-03");
}
