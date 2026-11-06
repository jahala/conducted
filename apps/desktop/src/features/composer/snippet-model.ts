/**
 * @feature COMP-09 Prompt snippets
 * Owns: the one ranking rule shared by the snippet picker and the editor's snippet trigger.
 * Behaviour: ui-map.md 3.5 (the snippet trigger), 5.1 (Search snippets...).
 * Our design choice: a name match ranks above a keyword match, and an empty query keeps the
 * repository's name order. Both surfaces therefore offer the same rows for the same typing.
 * Must handle: a keyword that is null; a query matching neither name nor keyword (the snippet is
 * left out); an empty query (every snippet, in the order given).
 * Test first: with snippets named "Review" and "Fix", the query "rev" returns only "Review".
 */
import { rankFuzzy } from "../../core/fuzzy.ts";
import type { Snippet } from "../../core/model.ts";

/** The snippets whose name or keyword matches `query`, best match first. */
export function filterSnippets(snippets: readonly Snippet[], query: string): Snippet[] {
	return rankFuzzy(
		snippets,
		query,
		[
			{ text: (snippet) => snippet.name, weight: 3 },
			{ text: (snippet) => snippet.keyword ?? "", weight: 2 },
		],
		snippets.length,
	).map((ranked) => ranked.item);
}
