/**
 * The token syntax for mentions inside a message. The composer writes these tokens and the
 * sidecar expands them before the agent reads the message, so the syntax has one home here.
 * Research: sessions.md section 9 "Message enrichment" (Conductor uses its own bracket tokens).
 * Our design choice: the syntax is ours: ⟦file:<path>⟧ and ⟦pr:<number>⟧.
 */

/** Matches one mention token. Group 1 is the kind, group 2 the value. Use with matchAll or replace. */
export const MENTION_TOKEN = /⟦(file|pr):([^⟧]*)⟧/g;

export type MentionKind = "file" | "pr";

export function formatFileMention(path: string): string {
	return `⟦file:${path}⟧`;
}

export function formatPullRequestMention(number: number): string {
	return `⟦pr:${number}⟧`;
}
