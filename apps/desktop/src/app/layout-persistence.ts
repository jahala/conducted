/**
 * @feature NAV-01 Persisted panel sizes
 * Owns: saving and loading the size of each resizable panel group, so the window comes back as the user left it.
 * Behaviour: ui-map.md 1.1 (persisted sidebar width with min and max; layout ids are persisted per workspace,
 * for example "workspace-right-panels-<workspaceId>"), frontend.md 4 (about 30 UI keys live in the settings table).
 * Our design choice: a group's layout is one small UI value, keyed by its group id and stored under a namespaced
 * browser-storage key. The panel library reports sizes as percentages, so that is the shape saved. Groups hand us
 * `onLayoutChanged`, which only fires after the pointer is released, so a drag writes once. A caller may pass the
 * storage it wants; the app uses the window's storage.
 * Must handle: a saved layout for panels that no longer exist is ignored; a layout that fails to parse is ignored
 * (the defaults apply); a collapsed panel is saved at 0 so it comes back collapsed; the layout of a deleted
 * workspace is removed with `clearPanelLayout`.
 * Test first: saving then loading a layout for "app-shell" returns the same sizes.
 */

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
