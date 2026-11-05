/**
 * @feature AGENT-03 Translate agent output to the neutral format: shared helpers
 * Owns: the small pure helpers every translator uses: cutting long tool output, turning content
 * blocks into plain text, and parsing JSON safely.
 * Behaviour: research/conductor/other-runners.md section 3 (normalised tool results) and
 * packages/protocol/src/agent-message.ts (tool results carry plain text; long output is cut by the
 * runner and flagged with `truncated`).
 * Must handle: output exactly at the limit (kept whole), output over the limit (the middle is cut,
 * keeping the start and the end so a final error survives, never inside a surrogate pair),
 * non-string content (blocks with a text field are joined with a blank line, other blocks are
 * skipped), and null or undefined (empty string).
 * Test first: output over a large limit keeps its first part and its last part with a note, and a
 * small limit keeps the head.
 * Our design choice: the limit is 100 000 characters per tool result, which keeps a chat's event
 * log small (see the data-lifetime job DATA-02) while showing a full screen of output. The note
 * counts the characters removed, so a reader can tell how much is missing.
 */
export const MAX_TOOL_OUTPUT_CHARS = 100_000;

/** Below this limit a note would leave no room for any text, so the head is kept alone. */
const CUT_NOTE_MIN_ROOM = 32;
const CUT_NOTE_PREFIX = "\n\n…[";
const CUT_NOTE_SUFFIX = " characters cut]…\n\n";

export interface TruncatedOutput {
	output: string;
	truncated: boolean;
	/** Length of the whole output before it was cut. Set when `truncated` is true. */
	originalLength?: number;
}

function cutNote(characters: number, originalLength: number): string {
	return `${CUT_NOTE_PREFIX}${characters} of ${originalLength}${CUT_NOTE_SUFFIX}`;
}

/** The end index of a head of `length` characters, moved back off a high surrogate. */
function headEnd(text: string, length: number): number {
	let end = Math.min(Math.max(0, length), text.length);
	if (end > 0 && end < text.length) {
		const last = text.charCodeAt(end - 1);
		if (last >= 0xd800 && last <= 0xdbff) end -= 1;
	}
	return end;
}

/** The start index of a tail of `length` characters, moved forward off a low surrogate. */
function tailStart(text: string, length: number): number {
	let start = Math.max(0, text.length - Math.max(0, length));
	if (start > 0 && start < text.length) {
		const first = text.charCodeAt(start);
		if (first >= 0xdc00 && first <= 0xdfff) start += 1;
	}
	return start;
}

export function truncateOutput(text: string, max: number = MAX_TOOL_OUTPUT_CHARS): TruncatedOutput {
	if (text.length <= max) return { output: text, truncated: false };
	const originalLength = text.length;
	if (max < CUT_NOTE_MIN_ROOM) {
		return { output: text.slice(0, headEnd(text, max)), truncated: true, originalLength };
	}

	let headLength = Math.floor(max / 2);
	let tailLength = max - headLength;
	// The note's digit count changes the room left for text, so settle it in a few steps.
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const cut = originalLength - headLength - tailLength;
		const room = Math.max(0, max - cutNote(cut, originalLength).length);
		headLength = Math.floor(room / 2);
		tailLength = room - headLength;
	}
	const headStop = headEnd(text, headLength);
	const tailBegin = Math.max(headStop, tailStart(text, tailLength));
	const cut = Math.max(0, tailBegin - headStop);
	return {
		output: text.slice(0, headStop) + cutNote(cut, originalLength) + text.slice(tailBegin),
		truncated: true,
		originalLength,
	};
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
