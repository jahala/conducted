/**
 * @feature REV-08 Find and replace in the editor
 * Owns: the pure search behind the find bar: building the pattern from the query and the three
 * toggles, listing the matches, and replacing one or all of them.
 * Behaviour: ui-map.md 3.2 (edit mode: find and replace bar with Replace, Replace All, Previous,
 * Next).
 * Our design choice: the replacement is always literal text, in regex mode too, so "$1" or "$$5"
 * is written as typed. Replace and Replace All work on the same match list the count shows, and
 * empty matches (a regex such as "a*") are never counted or replaced.
 * Must handle: an empty query (no pattern, no error), an invalid regex (its message, no throw),
 * special characters in a literal query, whole word, and matches that sit next to each other.
 * Test first: replacing every "a" in "banana" with "$1" gives "b$1n$1n$1".
 */

export interface Match {
	start: number;
	end: number;
}

export function buildPattern(
	query: string,
	caseSensitive: boolean,
	wholeWord: boolean,
	regex: boolean,
): { pattern: RegExp | null; error: string | null } {
	if (query.length === 0) return { pattern: null, error: null };
	const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const wrapped = wholeWord ? `\\b(?:${source})\\b` : source;
	try {
		return { pattern: new RegExp(wrapped, caseSensitive ? "g" : "gi"), error: null };
	} catch (cause) {
		return { pattern: null, error: cause instanceof Error ? cause.message : "Invalid pattern." };
	}
}

/** Every non-empty match, in order. The pattern must carry the "g" flag. */
export function findMatches(text: string, pattern: RegExp | null): Match[] {
	if (pattern === null) return [];
	const matches: Match[] = [];
	pattern.lastIndex = 0;
	let match = pattern.exec(text);
	while (match !== null) {
		if (match[0].length === 0) {
			pattern.lastIndex += 1;
		} else {
			matches.push({ start: match.index, end: match.index + match[0].length });
		}
		match = pattern.exec(text);
	}
	return matches;
}

/** Replaces the given matches with the literal replacement. Matches must be in order. */
export function replaceMatches(
	text: string,
	matches: readonly Match[],
	replacement: string,
): string {
	let result = "";
	let last = 0;
	for (const match of matches) {
		result += text.slice(last, match.start) + replacement;
		last = match.end;
	}
	return result + text.slice(last);
}
