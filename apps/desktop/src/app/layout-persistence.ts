/**
 * @feature NAV-01 Persisted panel sizes
 * Owns: saving and loading the size of each resizable workspace panel group, so a workspace comes back as the
 * user left it, and the app shell's sidebar, which lives in the settings table instead.
 * Behaviour: ui-map.md 1.1 (persisted sidebar width with min and max; layout ids are persisted per workspace,
 * for example "workspace-right-panels-<workspaceId>"), frontend.md 4 (about 30 UI keys live in the settings
 * table), ui-dimensions.md 3 (left_panel_width and left_panel_visible hold the sidebar's width and open state).
 * Our design choice: a workspace group's layout is one small UI value, keyed by its group id and stored under a
 * namespaced browser-storage key. The panel library reports sizes as percentages, so that is the shape saved.
 * Groups hand us `onLayoutChanged`, which only fires after the pointer is released, so a drag writes once. A
 * caller may pass the storage it wants; the app uses the window's storage. The shell's facts are kept in the
 * settings table, so there is one home: this module never stores an "app-shell" entry.
 * Must handle: a saved layout for panels that no longer exist is ignored; a layout that fails to parse is ignored
 * (the defaults apply); a collapsed panel is saved at 0 so it comes back collapsed; the layouts of a workspace
 * the user deletes or archives are removed (`clearLayoutsOfClosedWorkspaces`, which the app shell runs while
 * it is mounted). Data lifetime: an entry lives until its workspace is deleted or archived. Unarchiving
 * starts from the default sizes.
 * Test first: saving then loading a layout for "workspace-right-panels-w1" returns the same sizes.
 */

import { ok, type Result } from "@conducted/shared";
import type { Workspace } from "../core/model.ts";
import { isArchivedWorkspace } from "../core/status/archived.ts";
import {
	sidebarSize,
	workspaceLayoutGroupId,
	workspaceRightPanelsGroupId,
} from "../ui/layout-sizes.ts";
import type { PanelLayout } from "../ui/resizable.tsx";

export type { PanelLayout } from "../ui/resizable.tsx";

export interface PanelLayoutStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const STORAGE_PREFIX = "conducted.panel-layout:";

/** The one key a group's layout is stored under. */
export const panelLayoutStorageKey = (groupId: string): string => `${STORAGE_PREFIX}${groupId}`;

/** The settings service as the shell persistence needs it: a sync read and an async write. */
export interface PanelLayoutSettings {
	get<T>(key: string): T;
	set(key: string, value: unknown): Promise<Result<void>>;
}

const SIDEBAR_MIN = Number.parseFloat(sidebarSize.min);
const SIDEBAR_MAX = Number.parseFloat(sidebarSize.max);
const SIDEBAR_DEFAULT = Number.parseFloat(sidebarSize.default);

/** A width in pixels, kept inside Conductor's 192px to 480px range. */
function clampSidebarWidth(pixels: number): number {
	return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(pixels)));
}

/** The sidebar width to restore, using the default when the stored value is not a number. */
export function shellSidebarWidth(settings: PanelLayoutSettings): number {
	const stored = settings.get<number>("left_panel_width");
	const width = typeof stored === "number" && Number.isFinite(stored) ? stored : SIDEBAR_DEFAULT;
	return clampSidebarWidth(width);
}

/**
 * Writes what a finished resize or toggle means to the settings table: whether the sidebar is open, and its
 * width in pixels when it is. Values that did not change are skipped, so mounting the shell writes nothing.
 * The first failed write is returned, so the caller can tell the user.
 */
export async function saveShellSidebar(
	settings: PanelLayoutSettings,
	size: { inPixels: number },
): Promise<Result<void>> {
	const open = size.inPixels > 0;
	if (settings.get<boolean>("left_panel_visible") !== open) {
		const saved = await settings.set("left_panel_visible", open);
		if (!saved.ok) return saved;
	}
	if (!open) return ok(undefined);
	const width = clampSidebarWidth(size.inPixels);
	if (settings.get<number>("left_panel_width") !== width) {
		return settings.set("left_panel_width", width);
	}
	return ok(undefined);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads a stored layout. Entries that are not a percentage between 0 and 100 are dropped. A value with nothing
 * usable left is null, so the caller keeps its defaults.
 */
export function parsePanelLayout(value: unknown): PanelLayout | null {
	if (!isRecord(value)) return null;
	const layout: PanelLayout = {};
	for (const [id, size] of Object.entries(value)) {
		if (id === "") continue;
		if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > 100) continue;
		layout[id] = size;
	}
	return Object.keys(layout).length === 0 ? null : layout;
}

function browserStorage(): PanelLayoutStorage | null {
	try {
		if (typeof window === "undefined") return null;
		return window.localStorage;
	} catch {
		return null;
	}
}

/**
 * Loads one group's layout. When `knownPanels` is given, entries for panels the group no longer has are
 * dropped, so a changed panel set falls back to the defaults instead of restoring a stale size.
 */
export function loadPanelLayout(
	groupId: string,
	knownPanels?: readonly string[],
	storage: PanelLayoutStorage | null = browserStorage(),
): PanelLayout | null {
	if (storage === null) return null;
	const text = storage.getItem(panelLayoutStorageKey(groupId));
	if (text === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	const layout = parsePanelLayout(parsed);
	if (layout === null) return null;
	if (knownPanels === undefined) return layout;
	const known = new Set(knownPanels);
	const filtered: PanelLayout = {};
	for (const [id, size] of Object.entries(layout)) {
		if (known.has(id)) filtered[id] = size;
	}
	return Object.keys(filtered).length === 0 ? null : filtered;
}

export function savePanelLayout(
	groupId: string,
	layout: PanelLayout,
	storage: PanelLayoutStorage | null = browserStorage(),
): void {
	if (storage === null) return;
	const clean = parsePanelLayout(layout);
	if (clean === null) {
		storage.removeItem(panelLayoutStorageKey(groupId));
		return;
	}
	storage.setItem(panelLayoutStorageKey(groupId), JSON.stringify(clean));
}

/** Removes a group's layout, for example when its workspace is deleted or archived. */
export function clearPanelLayout(
	groupId: string,
	storage: PanelLayoutStorage | null = browserStorage(),
): void {
	storage?.removeItem(panelLayoutStorageKey(groupId));
}

/** The workspace list as the layout cleanup reads it. */
interface WorkspaceList {
	workspacesById: Readonly<Record<string, Pick<Workspace, "state">>>;
}

/** The workspace service's store, which tells each change with the state before it. */
export interface WorkspaceListStore {
	subscribe(listener: (state: WorkspaceList, previous: WorkspaceList) => void): () => void;
}

/** Workspaces that were open in `previous` and are deleted or archived in `next`. */
export function workspacesClosed(previous: WorkspaceList, next: WorkspaceList): string[] {
	const closed: string[] = [];
	for (const [id, workspace] of Object.entries(previous.workspacesById)) {
		if (isArchivedWorkspace(workspace)) continue;
		const now = next.workspacesById[id];
		if (now === undefined || isArchivedWorkspace(now)) closed.push(id);
	}
	return closed;
}

/**
 * Removes the saved panel sizes of each workspace that is deleted or archived while it listens, so
 * the browser storage does not grow with every workspace ever made. Returns the unsubscribe.
 */
export function clearLayoutsOfClosedWorkspaces(
	workspaces: WorkspaceListStore,
	storage: PanelLayoutStorage | null = browserStorage(),
): () => void {
	return workspaces.subscribe((state, previous) => {
		if (state.workspacesById === previous.workspacesById) return;
		for (const id of workspacesClosed(previous, state)) {
			clearPanelLayout(workspaceLayoutGroupId(id), storage);
			clearPanelLayout(workspaceRightPanelsGroupId(id), storage);
		}
	});
}
