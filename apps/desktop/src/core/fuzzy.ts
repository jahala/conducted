/**
 * @feature APP-15 One shared fuzzy matcher
 * Owns: the one function that scores how well a query matches a text, and the helper that ranks a list with
 * it. Settings search, the command palette and the pickers all use it.
 * Behaviour: ui-map.md 6 (settings search is fuzzy over labels, descriptions and keywords, top 30 results,
 * arrow keys and Enter) and 8 ("Fuzzy search util `aO({items, query, fields, threshold})` is shared by
 * settings search and pickers"); native-and-sidecar-map.md (the file search in Rust has its own matcher,
 * `nucleo-matcher`, for file paths; this one is for short labels in the UI).
 * Moves onto it: features/settings/settings-search.ts (SET-02) and features/palette/palette-model.ts
 * (NAV-08). Both name "the same fuzzy matcher" in their headers and today have no matcher to call. Quick
 * open (REV-07) keeps asking Rust for file paths.
 * Our design choice: a match is a subsequence match, case and accent insensitive, scored higher for a
 * prefix, a word start, an exact run of letters and a short text. `fields` carry weights, so a title match
 * ranks above a description match, which ranks above a keyword match (the order SET-02 asks for). The
 * ranges are character indexes in the original text, so a row can highlight the matched letters.
 * Must handle: an empty or blank query (matches everything with score 0 when asked to rank, or nothing
 * when the caller says so); upper and lower case; accents ("e" matches "é"); a query with several words
 * (every word must match somewhere); letters out of order (no match); a candidate that is empty; a limit of
 * zero; ties (keep the input order); 5,000 candidates (a single pass each, no regex built from user text);
 * emoji and characters outside the basic plane (ranges stay valid indexes).
 * Test first: with the titles "App zoom" and "Code theme", the query "zom" matches only "App zoom", with
 * ranges covering the "z", "o" and "m".
 */
import { notImplemented } from "@conducted/shared";

export interface FuzzyRange {
	/** Index of the first matched character in the original text. */
	start: number;
	/** Index after the last matched character. */
	end: number;
}

export interface FuzzyMatch {
	/** Higher is better. Comparable only within one query. */
	score: number;
	ranges: readonly FuzzyRange[];
}

/** Null when the query does not match the candidate. */
export function fuzzyMatch(_query: string, _candidate: string): FuzzyMatch | null {
	return notImplemented("APP-15");
}

export interface FuzzyField<T> {
	text: (item: T) => string;
	/** How much a match in this field is worth, relative to the other fields. */
	weight: number;
}

export interface FuzzyRanked<T> {
	item: T;
	score: number;
	/** The ranges in each field, in the order of the `fields` argument. Empty for a field with no match. */
	ranges: readonly (readonly FuzzyRange[])[];
}

/** Ranks `items` by their best weighted field. Items that match no field are left out. */
export function rankFuzzy<T>(
	_items: readonly T[],
	_query: string,
	_fields: readonly FuzzyField<T>[],
	_limit: number,
): FuzzyRanked<T>[] {
	return notImplemented("APP-15");
}
