/**
 * @feature COMP-01 Composer editor
 * Owns: the one way plain text becomes editor content: each line break a hard break, each blank
 * line a new paragraph, and the text itself never read as HTML.
 * Behaviour: ui-map.md 3.5 (the composer is plain text; Shift+Enter is a line break).
 * Our design choice: the editor's `getText` writes a hard break as "\n" and a paragraph break as
 * "\n\n", so text turned into content this way reads back unchanged. A string given straight to
 * TipTap's `insertContent` is parsed as HTML, which drops "<ul>" and splits the paragraph there.
 * Must handle: an empty text (no nodes); a line break at either end; angle brackets and "&" (kept
 * as typed).
 * Test first: "a\nb" becomes a text, a hard break and a text, and "<ul>" stays text.
 */

export interface TextNode {
	type: "text";
	text: string;
}

export interface HardBreakNode {
	type: "hardBreak";
}

/** One paragraph's text as text nodes and hard breaks, for inserting at the caret. */
export function inlineTextContent(text: string): (TextNode | HardBreakNode)[] {
	const content: (TextNode | HardBreakNode)[] = [];
	for (const [index, line] of text.split("\n").entries()) {
		if (index > 0) content.push({ type: "hardBreak" });
		if (line.length > 0) content.push({ type: "text", text: line });
	}
	return content;
}

/** Turns the editor's plain text back into paragraphs and line breaks, so a restart keeps them. */
export function textToDocument(text: string): {
	type: "doc";
	content: { type: "paragraph"; content?: (TextNode | HardBreakNode)[] }[];
} {
	const paragraphs = text.split("\n\n").map((paragraph) => {
		const content = inlineTextContent(paragraph);
		return content.length === 0
			? { type: "paragraph" as const }
			: { type: "paragraph" as const, content };
	});
	return { type: "doc", content: paragraphs };
}
