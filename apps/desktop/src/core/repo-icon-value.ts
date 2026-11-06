/**
 * @feature PRJ-05 Repository icon
 * Owns: the one rule for how a repository's saved icon value is written and read: `emoji:<emoji>`
 * for an emoji or symbol, `file:<path>` for an image uploaded into app storage. The repository
 * service writes and trashes by it, and the sidebar's avatar reads by it.
 * Behaviour: ui-map.md 5.2 (the icon picker's sources: emoji, uploaded image).
 * Must handle: a null value and a value with neither prefix (not an upload).
 * Test first: an uploaded path written as a value reads back as the same path.
 */

export const EMOJI_PREFIX = "emoji:";
export const FILE_PREFIX = "file:";

/** The stored value for an emoji or symbol picked as the icon. */
export const emojiIconValue = (emoji: string): string => `${EMOJI_PREFIX}${emoji}`;

/** The stored value for an uploaded image copied into app storage. */
export const fileIconValue = (path: string): string => `${FILE_PREFIX}${path}`;

/** The path of an uploaded icon, or null when the value is not one. */
export function fileIconPath(value: string | null): string | null {
	return value !== null && value.startsWith(FILE_PREFIX) ? value.slice(FILE_PREFIX.length) : null;
}
