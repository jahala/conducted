/**
 * @feature SIDE-06 Write-ahead event log: file format
 * Owns: the shape of one chat's log file, how the file is named, and the storage port that reads
 * and writes it.
 * Behaviour: research/conductor/sessions.md section 5 "Durable event outbox": one JSON file per
 * chat, content { version, sessionId, nextSequence, pending[] }, written atomically (temp file with
 * mode 0600, fsync, rename, fsync of the directory), corrupt files block that chat instead of being
 * deleted. Conductor names the file base64url(utf16le(sessionId)).json.
 * Must handle: a session id with characters that are unsafe in file names (encoded, never used as
 * is), a file written by a newer version (refused, not rewritten), a temp file left by a crash
 * (removed at open), and a directory fsync failure (the chat is marked durability-uncertain and
 * refuses new events until the next successful write).
 * Test first: fileNameFor("a/b") contains no slash, and decodes back to "a/b".
 * Our design choice: the name is base64url of the UTF-8 id, and the file holds the full
 * SessionEvent (validated with the protocol schema), so a replay needs nothing else.
 * Data lifetime: see event-outbox.ts.
 */
import { zEventId, zSessionEvent, zSessionId } from "@conducted/protocol";
import type { AppError, Result } from "@conducted/shared";
import { z } from "zod";

export const OUTBOX_FILE_VERSION = 1;

export const zOutboxEntry = z.object({
	eventId: zEventId,
	sequence: z.number().int().nonnegative(),
	event: zSessionEvent,
	/** When the entry was written to the log, in ms since the epoch. */
	persistedAt: z.number(),
});
export type OutboxEntry = z.infer<typeof zOutboxEntry>;

export const zOutboxFile = z.object({
	version: z.literal(OUTBOX_FILE_VERSION),
	sessionId: zSessionId,
	/** The sequence number the next event gets. Never goes down, even when pending is empty. */
	nextSequence: z.number().int().nonnegative(),
	pending: z.array(zOutboxEntry),
});
export type OutboxFile = z.infer<typeof zOutboxFile>;

export function fileNameFor(sessionId: string): string {
	return `${Buffer.from(sessionId, "utf8").toString("base64url")}.json`;
}

export function sessionIdFromFileName(fileName: string): string | null {
	if (!fileName.endsWith(".json")) return null;
	const encoded = fileName.slice(0, -".json".length);
	if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
	return Buffer.from(encoded, "base64url").toString("utf8");
}

/** The directory and file operations the log needs. Production uses node:fs; tests use a temp dir. */
export interface OutboxStorage {
	/** File names (not paths) in the log directory. Creates the directory when missing. */
	list(): Promise<Result<string[], AppError>>;
	/** The text of a file, or null when it does not exist. */
	read(fileName: string): Promise<Result<string | null, AppError>>;
	/** Temp file (mode 0600), fsync, rename over the target, fsync the directory. */
	writeAtomic(fileName: string, text: string): Promise<Result<void, AppError>>;
	/** Moves a file to the Trash. Never deletes it outright. */
	moveToTrash(fileName: string): Promise<Result<void, AppError>>;
	/** Moves every leftover temp file to the Trash. Called at open. */
	cleanTempFiles(): Promise<Result<number, AppError>>;
}
