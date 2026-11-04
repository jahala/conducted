/**
 * @feature REV-08 Find and replace bar
 * Owns: the bar above the editor for searching in the open file.
 * Behaviour: ui-map.md 3.2 (edit mode: find and replace bar with Replace, Replace All, Previous,
 * Next).
 * Our design choice: this is our own bar driving the editor's search state, so it matches the app's
 * design instead of the library default.
 * Must handle: no match (count shows 0, buttons disabled), regex errors (inline, no throw), match
 * case and whole word toggles, Enter for next and Shift+Enter for previous, Escape closing and
 * returning focus to the editor, and Replace All being one undo step.
 * Test first: with the query "a" in "banana", the count reads 3 and Next moves between matches.
 */
import { notImplemented } from "@conducted/shared";

export interface FindReplaceBarProps {
	query: string;
	replacement: string;
	matchCount: number;
	currentIndex: number | null;
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
	regexError: string | null;
	onQueryChange: (query: string) => void;
	onReplacementChange: (replacement: string) => void;
	onToggle: (option: "caseSensitive" | "wholeWord" | "regex") => void;
	onNext: () => void;
	onPrevious: () => void;
	onReplace: () => void;
	onReplaceAll: () => void;
	onClose: () => void;
}

export function FindReplaceBar(_props: FindReplaceBarProps): never {
	return notImplemented("REV-08");
}
