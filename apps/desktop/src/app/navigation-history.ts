/**
 * @feature NAV-02 Restore the last place
 * Owns: choosing where the app opens at launch, and which tab a workspace opens on when its URL has none. Also
 * the saved-location codec the router reads at "/" and writes whenever a workspace route settles.
 * Behaviour: ui-map.md 2 (the "/" route restores the last workspace route on launch and skips archived ones;
 * with no search set the workspace route restores the last active search for that workspace).
 * Our design choice: the decision is a pure function. The caller supplies the saved location and the
 * workspaces it already loaded. The saved location is one small browser-storage value, like the panel layouts,
 * so the router can read it before the database is ready. A browser that refuses storage simply gets no saved
 * location, never an error.
 * Must handle: the saved workspace was archived or deleted (fall through to the last ready workspace, then to
 * the empty state); no saved location (the centre empty state stays); a saved search that names a closed tab or
 * a missing file is dropped by the search schema; unreadable storage text is ignored.
 * Test first: with the last workspace archived, the target is the most recently active ready workspace.
 */

import type { Workspace } from "../core/model.ts";
import { canOpenWorkspace } from "../core/workspace-open.ts";
import { type WorkspaceSearch, zWorkspaceSearch } from "../features/workspace/workspace-search.ts";

export interface SavedLocation {
	workspaceId: string | null;
	search: WorkspaceSearch | null;
}

export type RestoreTarget =
	| { kind: "workspace"; repoId: string; workspaceId: string; search: WorkspaceSearch | null }
	| { kind: "onboarding" }
	| { kind: "empty" };

/** The browser storage key the last workspace route is kept under. */
export const SAVED_LOCATION_KEY = "conducted.workspace-location-v1";

/** The storage operations the codec needs, so tests can pass a map instead of the browser's storage. */
export interface SavedLocationStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function browserStorage(): SavedLocationStorage | null {
	try {
		if (typeof window === "undefined") return null;
		return window.localStorage;
	} catch {
		return null;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads one saved value. A wrong shape, a missing workspace or bad search text is null. */
export function parseSavedLocation(value: unknown): SavedLocation | null {
	if (!isRecord(value)) return null;
	const workspaceId = value.workspaceId;
	if (workspaceId !== null && typeof workspaceId !== "string") return null;
	if (workspaceId === "") return null;
	let search: WorkspaceSearch | null = null;
	if (value.search !== undefined && value.search !== null) {
		const parsed = zWorkspaceSearch.safeParse(value.search);
		if (parsed.success) search = parsed.data;
	}
	return { workspaceId, search };
}

/** The last workspace route to reopen, or null when none was saved or the text cannot be read. */
export function readSavedLocation(
	storage: SavedLocationStorage | null = browserStorage(),
): SavedLocation | null {
	if (storage === null) return null;
	const text = storage.getItem(SAVED_LOCATION_KEY);
	if (text === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	return parseSavedLocation(parsed);
}

/** Saves the last workspace route. A null workspace clears it, so "/" opens the empty state. */
export function saveSavedLocation(
	location: SavedLocation,
	storage: SavedLocationStorage | null = browserStorage(),
): void {
	if (storage === null) return;
	if (location.workspaceId === null) {
		storage.removeItem(SAVED_LOCATION_KEY);
		return;
	}
	storage.setItem(SAVED_LOCATION_KEY, JSON.stringify(location));
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
		if (workspace !== undefined && canOpenWorkspace(workspace)) {
			return workspaceTarget(workspace, saved.search);
		}
		// The saved workspace was deleted or archived: open the most recent ready one instead.
		const fallback = mostRecentlyActiveReady(input.workspaces);
		if (fallback !== null) return workspaceTarget(fallback, null);
	}
	return input.hasProjects ? { kind: "empty" } : { kind: "onboarding" };
}
