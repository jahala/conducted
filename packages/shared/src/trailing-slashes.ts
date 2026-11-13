/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: removing the slashes a path or URL ends with, in time in proportion to the slashes
 * removed. It replaces `text.replace(/\/+$/, "")`, which a regular expression engine runs in
 * time in proportion to the square of a run of slashes that does not end the text, so a URL from
 * the sandbox or a provider could stall the Worker (CodeQL `js/polynomial-redos`). Its twin removes
 * the slashes a path starts with, so a join of path parts needs no pattern either (#680). A guard
 * refuses the pattern in code.
 * Must handle: an empty text, a text of slashes only (it becomes empty, as the pattern made it),
 * and slashes in the middle (kept).
 * Test first: reads each character once, however many slashes the text holds.
 */

const SLASH = 47;

/**
 * How many characters at the end of a text of `length` are slashes, reading backwards from the end
 * and stopping at the first other character. `isSlash` reads one character by its index.
 */
export function trailingSlashCount(length: number, isSlash: (index: number) => boolean): number {
	let index = length;
	while (index > 0 && isSlash(index - 1)) index -= 1;
	return length - index;
}

/** `text` without the slashes it ends with. */
export function trimTrailingSlashes(text: string): string {
	const count = trailingSlashCount(text.length, (index) => text.charCodeAt(index) === SLASH);
	return count === 0 ? text : text.slice(0, text.length - count);
}

/** `text` without the slashes it starts with. */
export function trimLeadingSlashes(text: string): string {
	let index = 0;
	while (index < text.length && text.charCodeAt(index) === SLASH) index += 1;
	return index === 0 ? text : text.slice(index);
}
