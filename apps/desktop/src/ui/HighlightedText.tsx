/**
 * @feature APP-13 HighlightedText
 * Owns: text with the parts that match a search query marked, for settings search results and the command
 * palette.
 * Behaviour: ui-map.md 8 (search-highlight text `iu`; settings search and the palette use it),
 * 6 and 5.1 (fuzzy matches in settings and the palette).
 * Our design choice: matching ignores case and treats the query as plain text, so a search for "a." or
 * "(beta)" never fails because those characters mean something in a regular expression. Every match is
 * marked, not just the first. The marks use the highlight surface and foreground tokens, which meet AA.
 * Must handle: an empty query; a query that does not match; several matches; regular-expression symbols;
 * text that keeps its original case.
 * Test first: every case-insensitive match is wrapped in a marked element and the text itself is unchanged.
 */
import { cn } from "./cn.ts";

export interface HighlightPart {
	text: string;
	match: boolean;
	/** Where the part starts in the original text, used as a stable key. */
	start: number;
}

/** Splits `text` into the parts that match `query` and the parts between them. */
export function splitHighlight(text: string, query: string): HighlightPart[] {
	if (query.length === 0) return [{ text, match: false, start: 0 }];
	// The `iu` flags (ui-map.md 8) match case-insensitively on the original text, so offsets stay right for
	// letters whose lower-case form has another length (for example "İ").
	const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
	const parts: HighlightPart[] = [];
	let from = 0;
	for (const found of text.matchAll(matcher)) {
		const at = found.index;
		if (at > from) parts.push({ text: text.slice(from, at), match: false, start: from });
		parts.push({ text: found[0], match: true, start: at });
		from = at + found[0].length;
	}
	if (from < text.length) parts.push({ text: text.slice(from), match: false, start: from });
	return parts;
}

export interface HighlightedTextProps {
	text: string;
	query: string;
	className?: string;
}

export function HighlightedText({ text, query, className }: HighlightedTextProps) {
	const parts = splitHighlight(text, query);
	return (
		<span className={className}>
			{parts.map((part) =>
				part.match ? (
					<mark
						key={part.start}
						className={cn("rounded-xs bg-highlight-surface px-0.5 text-highlight-fg")}
					>
						{part.text}
					</mark>
				) : (
					part.text
				),
			)}
		</span>
	);
}
