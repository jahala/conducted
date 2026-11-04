/**
 * @feature NAV-02 Restore the last place
 * Owns: choosing where the app opens at launch, and which tab a workspace opens on when its URL has none.
 * Behaviour: ui-map.md 2 (the "/" route restores the last route and last workspace on launch and skips archived
 * ones; with no search set the workspace route restores the last active search for that workspace).
 * Our design choice: the last location and each workspace's last search are saved as settings (JSON), written
 * when the route settles. This file holds only the decision, as a pure function; the router adapter calls it.
 * Must handle: the saved workspace was archived or deleted (fall through to the last non-archived one, then to
 * the empty state); no saved location (first launch goes to /first-run-onboarding when no project exists, else
 * to the empty state); a saved search that names a closed tab or a missing file is dropped by the search schema.
 * Test first: with the last workspace archived, the target is the most recently active ready workspace.
 */
import { notImplemented } from "@conducted/shared";
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

export function chooseRestoreTarget(_input: {
	saved: SavedLocation | null;
	workspaces: Workspace[];
	hasProjects: boolean;
}): RestoreTarget {
	return notImplemented("NAV-02");
}
