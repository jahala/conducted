/**
 * @feature NAV-02 Restore the last place
 * Owns: choosing where the app opens at launch, and which tab a workspace opens on when its URL has none.
 * Behaviour: ui-map.md 2 (the "/" route restores the last route and last workspace on launch and skips archived
 * ones; with no search set the workspace route restores the last active search for that workspace).
 * Our design choice: the decision is a pure function. The caller supplies the saved location it read from the
 * settings table and the workspaces it already loaded. Saving the location when the route settles belongs to
 * the app entry, which owns the settings keys.
 * Must handle: the saved workspace was archived or deleted (fall through to the last ready workspace, then to
 * the empty state); no saved location (first launch goes to /first-run-onboarding when no project exists, else
 * to the empty state); a saved search that names a closed tab or a missing file is dropped by the search schema.
 * Test first: with the last workspace archived, the target is the most recently active ready workspace.
 */
import type { Workspace } from "../core/model.ts";
import type { WorkspaceSearch } from "../features/workspace/workspace-search.ts";

export interface SavedLocation {
	workspaceId: string | null;
	search: WorkspaceSearch | null;
}

export type RestoreTarget =
	| { kind: "workspace"; repoId: string; workspaceId: string; search: WorkspaceSearch | null }
	| { kind: "onboarding" }
	| { kind: "empty" };

/** A workspace whose route can still open: everything except one being archived or already archived. */
function canOpen(workspace: Workspace): boolean {
	return workspace.state !== "archived" && workspace.state !== "archiving";
}

/** The ready workspace the user worked in most recently. Ids break ties, so the answer is stable. */
function mostRecentlyActiveReady(workspaces: Workspace[]): Workspace | null {
	let best: Workspace | null = null;
	for (const workspace of workspaces) {
		if (workspace.state !== "ready") continue;
		if (best === null || isMoreRecent(workspace, best)) best = workspace;
	}
	return best;
}

function isMoreRecent(candidate: Workspace, current: Workspace): boolean {
	if (candidate.lastActivityAt !== current.lastActivityAt) {
		return candidate.lastActivityAt > current.lastActivityAt;
	}
	if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
	return candidate.id.localeCompare(current.id) < 0;
}

function workspaceTarget(workspace: Workspace, search: WorkspaceSearch | null): RestoreTarget {
	return {
		kind: "workspace",
		repoId: workspace.repoId,
		workspaceId: workspace.id,
		search,
	};
}

/**
 * Where the app opens. The saved workspace wins while it still exists and is not archived. Otherwise the
 * most recently used ready workspace does. With neither, a first run without projects shows onboarding and
 * every other case shows the centre empty state.
 */
export function chooseRestoreTarget(input: {
	saved: SavedLocation | null;
	workspaces: Workspace[];
	hasProjects: boolean;
}): RestoreTarget {
	const saved = input.saved;
	if (saved !== null && saved.workspaceId !== null) {
		const workspace = input.workspaces.find((candidate) => candidate.id === saved.workspaceId);
		if (workspace !== undefined && canOpen(workspace)) {
			return workspaceTarget(workspace, saved.search);
		}
	}
	const fallback = mostRecentlyActiveReady(input.workspaces);
	if (fallback !== null) return workspaceTarget(fallback, null);
	return input.hasProjects ? { kind: "empty" } : { kind: "onboarding" };
}
