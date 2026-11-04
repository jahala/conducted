/**
 * @feature NAV-08 Command palette model
 * Owns: The pure function that builds the palette's groups and items from workspaces, repos,
 * commands and settings pages for the current tab and query.
 * Behaviour: ui-map.md 5.1 (groups and items), 5.4 (the command registry feeds the palette).
 * Our design choice: Pure, so it is tested without React. Ranking uses the same fuzzy matcher as
 * settings search.
 * Must handle: Empty query (recent items first); a query with no matches (empty result, not an
 * error); the same workspace never appears twice in one group; archived workspaces only under
 * Archived; commands whose `enabled` is false are marked disabled.
 * Test first: With two workspaces and the query 'fix', only the one named 'fix-login' is returned,
 * under Workspaces.
 */
import { notImplemented } from "@conducted/shared";
import type { CommandEntry } from "../../core/api.ts";
import type { Repo, Workspace } from "../../core/model.ts";

export type PaletteTab = "all" | "workspaces" | "projects" | "actions" | "settings";

export interface PaletteItem {
	id: string;
	label: string;
	hint: string | null;
	shortcut: string | null;
	disabled: boolean;
}

export interface PaletteGroup {
	heading: string;
	items: PaletteItem[];
}

export interface PaletteInput {
	tab: PaletteTab;
	query: string;
	workspaces: Workspace[];
	repos: Repo[];
	commands: CommandEntry[];
	currentWorkspaceId: string | null;
}

export function buildPaletteGroups(_props: PaletteInput): PaletteGroup[] {
	return notImplemented("NAV-08");
}
