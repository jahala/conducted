/**
 * @feature AGENT-03 Translate agent output to the neutral format: shared helpers
 * Owns: the small pure helpers every translator uses: cutting long tool output, turning content
 * blocks into plain text, and parsing JSON safely.
 * Behaviour: research/conductor/other-runners.md section 3 (normalised tool results) and
 * packages/protocol/src/agent-message.ts (tool results carry plain text; long output is cut by the
 * runner and flagged with `truncated`).
 * Must handle: output exactly at the limit (kept whole), output over the limit (cut at a character
 * boundary, never inside a surrogate pair), non-string content (blocks with a text field are
 * joined with a blank line, other blocks are skipped), and null or undefined (empty string).
 * Test first: truncateOutput("a".repeat(10), 4) returns "aaaa" with truncated true.
 * Our design choice: the limit is 100 000 characters per tool result, which keeps a chat's event
 * log small (see the data-lifetime job DATA-02) while showing a full screen of output.
 */
export const MAX_TOOL_OUTPUT_CHARS = 100_000;

export function truncateOutput(
	text: string,
	max: number = MAX_TOOL_OUTPUT_CHARS,
): { output: string; truncated: boolean } {
	if (text.length <= max) return { output: text, truncated: false };
	let end = max;
	const last = text.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end -= 1;
	return { output: text.slice(0, end), truncated: true };
}

/** Joins the text parts of a content value (a string, or an array of blocks with a `text` field). */
export function contentToText(content: unknown): string {
	if (content === null || content === undefined) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (typeof block === "string") return block;
				if (block && typeof block === "object" && "text" in block) {
					const text = (block as { text: unknown }).text;
					return typeof text === "string" ? text : "";
				}
				return "";
			})
			.filter((part) => part !== "")
			.join("\n\n");
	}
	return "";
}

export function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
