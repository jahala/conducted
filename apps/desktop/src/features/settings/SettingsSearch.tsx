/**
 * @feature SET-02 Settings search
 * Owns: the search box and its result list. Typing searches every setting's title, description and
 * keywords; choosing a result opens its page and highlights the setting.
 * Behaviour: ui-map.md 6 ("Search settings", Cmd+F, fuzzy over labels, descriptions and keywords,
 * top 30 results, arrow keys and Enter). The index comes from the settings registry (SET-01).
 * Children: uses searchSettings from settings-search.ts.
 * Must handle: an empty query (no list), no result (designed empty text), arrow keys wrapping,
 * Enter on no selection doing nothing, Escape clearing the query first and leaving on the second
 * press, and results from repository pages only when a repository is selected.
 * Test first: typing "zoom" lists the zoom setting first and Enter calls onOpen with its id.
 */
import { notImplemented } from "@conducted/shared";
import type { SearchableSetting } from "./settings-search.ts";

export interface SettingsSearchProps {
	index: readonly SearchableSetting[];
	onOpen: (setting: SearchableSetting) => void;
}

export function SettingsSearch(_props: SettingsSearchProps): never {
	return notImplemented("SET-02");
}
