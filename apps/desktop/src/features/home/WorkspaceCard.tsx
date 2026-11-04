/**
 * @feature NAV-05 Workspace card
 * Owns: One card in the Home grid: name, repository, branch, status, line changes and last
 * activity.
 * Behaviour: ui-map.md 2 (Home cards), 3.8 (status model), 4 (archived workspace row actions:
 * 'Unarchive workspace', 'Open in Finder', 'Copy path').
 * Must handle: Archived card (muted, shows Unarchive instead of opening); long names truncate;
 * status unknown (no status line); the whole card is one link, its action buttons are not nested
 * links; keyboard focus ring.
 * Test first: An archived workspace's card shows an Unarchive button and does not link to the
 * workspace.
 */
import { notImplemented } from "@conducted/shared";
import type { Repo, Workspace, WorkspaceStatus } from "../../core/model.ts";

export interface WorkspaceCardProps {
	workspace: Workspace;
	repo: Repo;
	status: WorkspaceStatus | null;
	/** Which optional fields to show, from the Display menu. */
	display: ReadonlySet<"repository" | "repositoryIcon" | "lineChanges" | "lastActive">;
}

export function WorkspaceCard(_props: WorkspaceCardProps): never {
	return notImplemented("NAV-05");
}
