/**
 * @feature SIDE-09 Prompt assembly: attachments and preferences
 * Owns: the two small blocks added around a message: the list of attached files and the user's
 * standing preferences.
 * Behaviour: research/conductor/claude-runner.md section 5 items 4 and 5 (attachments are listed in
 * an instruction block that asks the agent to read them first; preferences are appended in a tagged
 * block that outranks default guidelines; text that could pose as Conductor's own sender tag is
 * escaped).
 * Must handle: no attachments (no block), a path with spaces, preferences that are empty or only
 * whitespace (no block), and preferences that contain our closing tag (escaped so they cannot end
 * the block early).
 * Test first: preferences containing "</user_preferences>" cannot close the block early.
 */
export const ATTACHMENTS_TAG = "attached_files";
export const PREFERENCES_TAG = "user_preferences";

export function buildAttachmentsBlock(paths: readonly string[]): string | null {
	if (paths.length === 0) return null;
	return [
		`<${ATTACHMENTS_TAG}>`,
		"The user attached these files. Read them before you start.",
		...paths.map((path) => `- ${path}`),
		`</${ATTACHMENTS_TAG}>`,
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
