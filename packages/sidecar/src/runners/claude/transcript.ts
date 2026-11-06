/**
 * @feature SIDE-01 Entry point and modes: Claude transcripts on disk; RC-03 Accept input from claude.ai
 * Owns: finding Claude's own JSONL transcript for a chat, deciding whether it can be resumed, and
 * reading the text of one user message from it by uuid (RC-03: a message typed on claude.ai reaches
 * the stream only as its uuid, so its text comes from here).
 * Behaviour: research/conductor/claude-runner.md sections 1.5 and 6. The folder is
 * `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<cwd with every non-alphanumeric character replaced by
 * "-">`, and a mangled name longer than 200 characters takes a hash suffix. A transcript is
 * resumable only when it holds a user or assistant line that is not a sidechain. A transcript with
 * no conversation is renamed to `.stale`, so Claude can reuse its id.
 * Must handle: a missing file (not resumable, no rename), a file of only sidechain or system lines
 * (renamed), a malformed line among good ones (skipped), and a path that cannot be renamed (still
 * not resumable). Reading a user message: string or block content (text blocks joined by a line
 * break, other blocks left out), a sidechain line or a line of another type with the same uuid
 * (not the message), and a missing file or line (null, so the caller can try again).
 * Test first: a transcript holding a non-sidechain assistant line is resumable; one holding only a
 * sidechain line is not and is renamed to .stale.
 * Our design choice: the config folder is pinned once at start and passed in, so a later change to
 * `CLAUDE_CONFIG_DIR` cannot move the path a running sidecar already uses.
 */
import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { SessionId } from "@conducted/shared";

/** Conductor's limit on a project folder name; past it, the name takes a hash suffix. */
export const CLAUDE_PROJECT_FOLDER_MAX = 200;

/** The folder Claude keeps its state in: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function claudeConfigDir(env: Readonly<Record<string, string | undefined>>): string {
	const configured = env.CLAUDE_CONFIG_DIR;
	if (configured !== undefined && configured !== "") return configured;
	return join(env.HOME ?? "", ".claude");
}

/** The project folder name Claude uses for a working directory. */
export function projectFolderName(cwd: string): string {
	const normalized = cwd.normalize("NFC");
	const mangled = normalized.replace(/[^a-zA-Z0-9]/g, "-");
	if (mangled.length <= CLAUDE_PROJECT_FOLDER_MAX) return mangled;
	return `${mangled.slice(0, CLAUDE_PROJECT_FOLDER_MAX)}-${pathHash(normalized)}`;
}

/** The Claude transcript file for one chat. */
export function transcriptPath(sessionId: string, cwd: string, configDir: string): string {
	return join(configDir, "projects", projectFolderName(cwd), `${sessionId}.jsonl`);
}

/** A transcript check with the config folder pinned, for the runner's `hasTranscript` port. */
export function createTranscriptCheck(
	configDir: string,
): (sessionId: SessionId, cwd: string) => Promise<boolean> {
	return (sessionId, cwd) => hasResumableTranscript(sessionId, cwd, configDir);
}

/** True when Claude's transcript holds a non-sidechain user or assistant line. */
export async function hasResumableTranscript(
	sessionId: string,
	cwd: string,
	configDir: string,
): Promise<boolean> {
	const target = transcriptPath(sessionId, cwd, configDir);
	let text: string;
	try {
		text = await readFile(target, "utf8");
	} catch {
		return false;
	}
	if (hasConversationLine(text)) return true;
	// Claude must be able to reuse this session id, so keep the empty file for inspection under a
	// name that is no longer a transcript.
	await rename(target, `${target}.stale`).catch(() => {});
	return false;
}

/**
 * Reads the text of one main-thread user message from a chat's transcript, with the config folder
 * pinned. Null when the file or the line is not there (yet).
 */
export function createUserMessageReader(
	configDir: string,
): (agentSessionId: string, cwd: string, uuid: string) => Promise<string | null> {
	return async (agentSessionId, cwd, uuid) => {
		let text: string;
		try {
			text = await readFile(transcriptPath(agentSessionId, cwd, configDir), "utf8");
		} catch {
			// Claude may not have written the file yet; the caller asks again.
			return null;
		}
		return userMessageText(text, uuid);
	};
}

function userMessageText(transcript: string, uuid: string): string | null {
	for (const line of transcript.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || !trimmed.includes(uuid)) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as {
			type?: unknown;
			uuid?: unknown;
			isSidechain?: unknown;
			message?: { content?: unknown };
		};
		if (record.uuid !== uuid || record.type !== "user" || record.isSidechain === true) continue;
		const content = record.message?.content;
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return null;
		const texts = content.flatMap((block: unknown) => {
			const part = block as { type?: unknown; text?: unknown };
			return part.type === "text" && typeof part.text === "string" ? [part.text] : [];
		});
		return texts.join("\n");
	}
	return null;
}

/** The hash suffix Conductor puts on a long project folder name, in base 36. */
function pathHash(value: string): string {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
	}
	return Math.abs(hash).toString(36);
}

function hasConversationLine(text: string): boolean {
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		let entry: unknown;
		try {
			entry = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as { type?: unknown; isSidechain?: unknown };
		if (record.isSidechain === true) continue;
		if (record.type === "user" || record.type === "assistant") return true;
	}
	return false;
}
