/**
 * @feature REV-03 Suggestion block
 * Owns: the "suggested change" part of a comment. It shows the original lines and the suggested
 * replacement as a small diff.
 * Behaviour: ui-map.md 3.6 ("Suggested change block"). The comment row stores the replacement text
 * in diff_comments.suggestion.
 * Must handle: a suggestion identical to the original (shown as no change), an empty suggestion
 * (means delete the lines), very long suggestions (scroll, not grow), and a line range that no
 * longer matches the file (shown with an "outdated" note).
 * Test first: original "a" and suggestion "b" render one removed and one added line.
 */
import { notImplemented } from "@conducted/shared";

export interface SuggestionBlockProps {
	original: string;
	suggestion: string;
	filePath: string;
}

export function SuggestionBlock(_props: SuggestionBlockProps): never {
	return notImplemented("REV-03");
}
