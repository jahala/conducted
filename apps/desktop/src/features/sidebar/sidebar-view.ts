/**
 * @feature NAV-03 Sidebar grouping, filtering and sorting
 * Owns: The pure function that turns workspaces, repos and derived statuses into the groups the
 * sidebar shows, plus the view options type.
 * Behaviour: ui-map.md 4 items 4 to 7 (Pinned, sections, main list by status or project; manual
 * order per list), 3.8 (status model).
 * Our design choice: A pure function with all inputs passed in, so it is tested without React or a
 * database.
 * Must handle: Pinned first; each workspace once; sections in their saved order; status groups in
 * the fixed status order; sort by last activity or creation time; manual order wins when on; ties
 * break by id so the order is stable; workspaces of hidden repos are left out; archived workspaces
 * are left out.
 * Test first: Three workspaces with mixed statuses and one pinned give Pinned, then status groups
 * in the fixed order, each sorted by last activity.
 */

import type { RepoId, WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Repo, Section, Workspace, WorkspaceStatus } from "../../core/model.ts";

export interface SidebarView {
	groupBy: "status" | "project";
	sortBy: "updated" | "created";
	/** When true the user's own order is used and sortBy is ignored. */
	manualOrder: boolean;
	/** Empty means all projects. */
	projectFilter: RepoId[];
}

export type SidebarGroupKey =
	| { kind: "pinned" }
	| { kind: "section"; sectionId: string }
	| { kind: "status"; status: string }
	| { kind: "project"; repoId: RepoId };

export interface SidebarGroup {
	key: SidebarGroupKey;
	label: string;
	workspaceIds: WorkspaceId[];
}

export interface SidebarViewInput {
	repos: Repo[];
	workspaces: Workspace[];
	sections: Section[];
	statuses: ReadonlyMap<WorkspaceId, WorkspaceStatus | null>;
	view: SidebarView;
	manualOrder: ReadonlyMap<string, WorkspaceId[]>;
}

export function buildSidebarGroups(_props: SidebarViewInput): SidebarGroup[] {
	return notImplemented("NAV-03");
}
