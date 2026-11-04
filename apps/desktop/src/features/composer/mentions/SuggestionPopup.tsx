/**
 * @feature COMP-04 Suggestion popup
 * Owns: The floating list that the '@', '#' and '/' triggers share: rows, selection, loading and
 * empty states.
 * Behaviour: ui-map.md 3.5 (triggers), 5.1 ('No results found').
 * Must handle: Arrow keys move the selection and wrap; Enter and Tab pick; the list is positioned
 * at the caret and flips above when there is no room below; loading row; empty row with a reason;
 * options are announced with role 'listbox' and 'option'.
 * Test first: Given three items and selectedIndex 1, the second row has aria-selected true;
 * clicking a row calls onPick with it.
 */
import { notImplemented } from "@conducted/shared";

export interface SuggestionRow {
	id: string;
	label: string;
	detail?: string;
}

export interface SuggestionPopupProps {
	rows: SuggestionRow[];
	selectedIndex: number;
	state: "loading" | "ready" | "error";
	emptyText: string;
	onPick: (row: SuggestionRow) => void;
}

export function SuggestionPopup(_props: SuggestionPopupProps): never {
	return notImplemented("COMP-04");
}
