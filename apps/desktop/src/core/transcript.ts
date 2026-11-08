/**
 * @feature CHAT-17 Search past chats
 * Owns: the shortest query the history search runs, and the shape of one search hit. The
 * transcript service imports them.
 * Behaviour: services-map.md 5B.6 (history search).
 */
import type { SessionId } from "@conducted/shared";

export const HISTORY_SEARCH_MIN_QUERY = 2;

export interface HistoryHit {
	sessionId: SessionId;
	turnId: string;
	excerpt: string;
	at: number;
}
