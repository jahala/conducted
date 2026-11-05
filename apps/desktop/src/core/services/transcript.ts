/**
 * @feature CHAT-17 Copy transcript and search chat history
 * Built now: `escapeLike`, `HISTORY_SEARCH_SQL` and the minimum query length. `formatTranscript`
 * and `searchHistory` are placeholders (CHAT-17), so the behaviour below is not built yet.
 * Owns: turning a chat's turns into text for the clipboard, and the query that searches stored
 * chats.
 * Behaviour: ui-map.md 3.2 and 5.1 (copy concise transcript, chat history search), services-map.md
 * 2.3.3 (search is a LIKE over stored message text).
 * Must handle: "concise" keeps the user messages and the agent's text, and one line per tool
 * call; "full" adds thinking, tool inputs and outputs; reverted turns are left out; very large
 * tool outputs are cut at 2000 characters with a note; a search query under two characters
 * returns nothing; `%` and `_` in the query are matched literally; results name the chat, the
 * workspace and show a short excerpt; reverted events are not searched.
 * Our design choice: search runs over the event log's JSON text for `user_message` and `agent`
 * text items only, with a LIKE query. There is no full-text index yet.
 * Test first: a concise transcript of one turn lists the user text, then the agent text, then one
 * line for each tool call.
 */
import { notImplemented, type Result, type SessionId } from "@conducted/shared";
import type { ChatTurn } from "../model.ts";

/** Matches `%`, `_` and the escape character itself so the query is searched literally. */
export const escapeLike = (query: string): string => query.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export const HISTORY_SEARCH_MIN_QUERY = 2;

/** `$1` is `%<escaped query>%`, `$2` the row limit. Reverted events are not searched. */
export const HISTORY_SEARCH_SQL = `SELECT e.session_id AS session_id, e.turn_id AS turn_id,
  e.content AS content, e.received_at AS received_at
FROM session_events e
JOIN sessions s ON s.id = e.session_id
WHERE e.reverted_at IS NULL
  AND e.type IN ('user_message', 'agent')
  AND e.content LIKE $1 ESCAPE '\\'
ORDER BY e.received_at DESC
LIMIT $2`;

export interface HistoryHit {
	sessionId: SessionId;
	turnId: string;
	excerpt: string;
	at: number;
}

export function formatTranscript(_turns: readonly ChatTurn[], _detail: "concise" | "full"): string {
	return notImplemented("CHAT-17");
}

export interface TranscriptServiceDeps {
	search: (query: string, limit: number) => Promise<Result<HistoryHit[]>>;
}

export function searchHistory(
	_deps: TranscriptServiceDeps,
	_query: string,
	_limit: number,
): Promise<Result<HistoryHit[]>> {
	return notImplemented("CHAT-17");
}
