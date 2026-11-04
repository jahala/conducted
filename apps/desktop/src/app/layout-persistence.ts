/**
 * @feature NAV-01 Persisted panel sizes
 * Owns: saving and loading the size of each resizable panel group, so the window comes back as the user left it.
 * Behaviour: ui-map.md 1.1 (persisted sidebar width with min and max; layout ids are persisted per workspace,
 * for example "workspace-right-panels-<workspaceId>"), frontend.md 4 (about 30 UI keys live in the settings table).
 * Our design choice: one layout per group id, stored as a JSON setting through the settings service
 * (`settings.set`), not in browser storage. Groups hand us `onLayoutChanged`, which only fires after the pointer
 * is released, so a drag writes once.
 * Must handle: a saved layout for panels that no longer exist is ignored; a layout that fails to parse is ignored
 * (the defaults apply); a collapsed panel is saved as collapsed, not as size 0; the id of an archived or deleted
 * workspace's group is cleaned up with the workspace.
 * Test first: saving then loading a layout for "app-shell" returns the same sizes.
 */
import { notImplemented } from "@conducted/shared";

/** Panel id to size in percent (0..100), as react-resizable-panels reports it. */
export type PanelLayout = Record<string, number>;

export function loadPanelLayout(_groupId: string): PanelLayout | null {
	return notImplemented("NAV-01");
}

export function savePanelLayout(_groupId: string, _layout: PanelLayout): void {
	notImplemented("NAV-01");
}
