/**
 * @feature SIDE-09 Prompt assembly: attachments, preferences and linked folders
 * Owns: the small blocks added around a message: the files the message refers to or carries, the
 * user's standing preferences, and the folders linked to the workspace.
 * Behaviour: research/conductor/claude-runner.md section 5 items 4 and 5 (attachments are listed
 * in an instruction block that asks the agent to read them first; preferences are appended in a
 * tagged block that outranks default guidelines) and sessions.md section 9 (Codex and agents
 * without an add-dir flag get the linked folders in the message).
 * Must handle: no attachments (no block), a path with spaces, preferences that are empty or only
 * whitespace (no block), preferences that contain our closing tag (escaped so they cannot end the
 * block early), and a file whose size cannot be read (shown as "unknown size").
 * Test first: preferences containing "</user_preferences>" cannot close the block early.
 */
export const ATTACHMENTS_TAG = "attached_files";
export const PREFERENCES_TAG = "user_preferences";
export const LINKED_DIRECTORIES_TAG = "linked_directories";

/** One path as the agent reads it, with the size when the file could be read. */
export interface AttachmentEntry {
	path: string;
	/** Bytes, or null when the file's size could not be read. */
	sizeBytes: number | null;
}

/** The two lists from the research: files named in the message, and files the user attached. */
export interface AttachmentGroups {
	/** File mentions and the files named inside review-comment attachments. */
	referenced: readonly AttachmentEntry[];
	/** Files the user attached in the composer. */
	attached: readonly AttachmentEntry[];
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** A short size label such as "1.2 KB", "3.4 MB" or "unknown size". */
export function formatFileSize(sizeBytes: number | null): string {
	if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) return "unknown size";
	if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`;
	let value = sizeBytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const unit = SIZE_UNITS[unitIndex] ?? "B";
	return `${Number(value.toFixed(1))} ${unit}`;
}

function renderAttachmentGroup(instruction: string, entries: readonly AttachmentEntry[]): string {
	return [
		`<${ATTACHMENTS_TAG}>`,
		instruction,
		...entries.map(
			(entry) => `- ${escapeTag(entry.path, ATTACHMENTS_TAG)} (${formatFileSize(entry.sizeBytes)})`,
		),
		`</${ATTACHMENTS_TAG}>`,
	].join("\n");
}

export function buildAttachmentsBlock(groups: AttachmentGroups): string | null {
	const blocks: string[] = [];
	if (groups.referenced.length > 0) {
		blocks.push(
			renderAttachmentGroup(
				"The message refers to these files. Read them before you start.",
				groups.referenced,
			),
		);
	}
	if (groups.attached.length > 0) {
		blocks.push(
			renderAttachmentGroup(
				"The user attached these files. Read the attached files before you start.",
				groups.attached,
			),
		);
	}
	return blocks.length === 0 ? null : blocks.join("\n\n");
}

export function buildLinkedDirectoriesBlock(paths: readonly string[]): string | null {
	if (paths.length === 0) return null;
	return [
		`<${LINKED_DIRECTORIES_TAG}>`,
		"These folders are linked to this workspace. You may read and change them when the task involves files outside the workspace:",
		...paths.map((path) => `- ${escapeTag(path, LINKED_DIRECTORIES_TAG)}`),
		`</${LINKED_DIRECTORIES_TAG}>`,
	].join("\n");
}

function escapeTag(text: string, tag: string): string {
	return text.replaceAll(`</${tag}`, `<\\/${tag}`).replaceAll(`<${tag}`, `<\\${tag}`);
}

export function buildPreferencesBlock(preferences: string | undefined): string | null {
	if (preferences === undefined || preferences.trim() === "") return null;
	return [
		`<${PREFERENCES_TAG}>`,
		"These are the user's standing preferences. They take precedence over default guidelines.",
		escapeTag(preferences.trim(), PREFERENCES_TAG),
		`</${PREFERENCES_TAG}>`,
	].join("\n");
}
