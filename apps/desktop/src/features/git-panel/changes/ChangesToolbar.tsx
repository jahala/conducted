/**
 * @feature REV-01 Changes toolbar
 * Owns: the row above the changed file list. A filter box, the flat or folder view toggle, and
 * the diff scope menu.
 * Behaviour: ui-map.md 3.6 ("Filter changed files", "Show flat list" or "Show folder hierarchy",
 * options menu for the diff scope).
 * Must handle: the filter being cleared with Escape, the view choice surviving restarts (a setting,
 * not component state), the scope menu showing which scope is active, and a narrow panel.
 * Test first: typing in the filter calls onFilterChange with the text, and Escape calls it with "".
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { DiffScope } from "../../../core/api.ts";

export interface ChangesToolbarProps {
	workspaceId: WorkspaceId;
	filter: string;
	onFilterChange: (filter: string) => void;
	view: "flat" | "folders";
	onViewChange: (view: "flat" | "folders") => void;
	scope: DiffScope;
	onScopeChange: (scope: DiffScope) => void;
}

export function ChangesToolbar(_props: ChangesToolbarProps): never {
	return notImplemented("REV-01");
}
