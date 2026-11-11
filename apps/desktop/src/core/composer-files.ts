/**
 * @feature COMP-01 Composer data: drafts that survive restarts and attachments
 * @feature CHAT-26 Start a chat with earlier chats and plans
 * Owns: the paste-to-attachment thresholds, the file names the app keeps for its own context
 * files, the name a picked or pasted file is attached under, and the names an attached transcript
 * or plan is saved under. The composer service and the attachments hook share them.
 * Behaviour: services-map.md 5A.6.2 item 6, 5B.8.3 (context files), ui-map.md 3.5 (composer).
 */

export const PASTE_ATTACHMENT_MIN_LINES = 90;
export const PASTE_ATTACHMENT_MIN_CHARS = 5_000;

/** True when pasted text is long enough to become an attachment instead of staying in the editor. */
export const convertsToAttachment = (text: string): boolean =>
	text.length > PASTE_ATTACHMENT_MIN_CHARS || text.split("\n").length > PASTE_ATTACHMENT_MIN_LINES;

/**
 * File names the app keeps for its own context files (services-map.md 5A.6.2 item 6, 5B.8.3): the PR,
 * review and fix-errors instructions, GitHub and Linear issue files, and terminal output.
 */
const RESERVED_CONTEXT_NAMES: readonly RegExp[] = [
	/^PR instructions\.md$/i,
	/^Review request\.md$/i,
	/^Fix errors instructions\.md$/i,
	/^\[GITHUB\]-\d+\.md$/i,
	/^\[LINEAR\]-\w{1,7}-\d+\.md$/i,
	/^terminal-output(-.*)?\.txt$/i,
];

/**
 * The name a user's picked, dropped or pasted file is attached under. A reserved context name cannot be
 * used, so the app would never take the user's file for its own.
 * Our design choice: such a file is renamed to `attached-<name>` instead of refused, so it still attaches.
 */
export function userAttachmentName(name: string): string {
	return RESERVED_CONTEXT_NAMES.some((pattern) => pattern.test(name)) ? `attached-${name}` : name;
}

/** Keeps a file name inside the staging folder. A name without an extension gets `.txt`. */
export function attachmentFileName(name: string): string {
	const cleaned = name.replace(/[/\\]/g, "-").replace(/\.\./g, "-").trim();
	const base = cleaned.length === 0 ? "terminal-selection" : cleaned;
	return base.includes(".") ? base : `${base}.txt`;
}

/**
 * The file name an attached chat transcript is saved under (CHAT-26). Conductor names a chat with
 * no title "chat" here.
 */
export function chatTranscriptFileName(title: string | null): string {
	const trimmed = title?.trim() ?? "";
	return attachmentFileName(`Transcript of ${trimmed.length === 0 ? "chat" : trimmed}.md`);
}

/** The file name an attached plan is saved under: its title, as Markdown (CHAT-26). */
export function planFileName(title: string): string {
	return attachmentFileName(title.toLowerCase().endsWith(".md") ? title : `${title}.md`);
}
