/**
 * @feature SET-02 Settings search function
 * Owns: the pure fuzzy search over the settings index.
 * Behaviour: ui-map.md 6 (fuzzy over all setting labels, descriptions and keywords, top 30
 * results). Conductor shares one fuzzy utility between settings search and pickers (ui-map.md 8).
 * Our design choice: title matches rank above description matches, which rank above keyword
 * matches; ties keep registry order.
 * Must handle: an empty or blank query (empty result), upper and lower case, accents, a query with
 * several words (all must match somewhere), a limit of zero, and an index with duplicate titles on
 * different pages.
 * Test first: with titles "App zoom" and "Code theme", the query "zom" returns only "App zoom".
 */
import { notImplemented } from "@conducted/shared";
import type { RepoSettingsPageId, UserSettingsPageId } from "./settings-pages.ts";

export interface SearchableSetting {
	/** The registry key. */
	key: string;
	title: string;
	description: string;
	keywords: readonly string[];
	page: UserSettingsPageId | { repoPage: RepoSettingsPageId };
}

export function searchSettings(
	_index: readonly SearchableSetting[],
	_query: string,
	_limit: number,
): SearchableSetting[] {
	return notImplemented("SET-02");
}
