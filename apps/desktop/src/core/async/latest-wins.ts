/**
 * @feature APP-11 Latest wins
 * Owns: dropping an async answer that arrives after a newer request for the same key, so only the newest
 * result changes state.
 * Behaviour: docs/architecture.md, State and time ("Only the newest async result changes state"; UI services
 * drop query results whose request id is no longer the latest); backlog row APP-11 cites services-map.md 2.6.
 * This is the one helper those services share, so the rule has one home.
 * Our design choice: a ticket is a counter per key, so no clock or random id is needed and the helper is
 * deterministic in tests.
 * Must handle: two requests in flight for one key (only the second applies, whatever order they finish); an
 * older request that fails (its error is dropped too); different keys (independent); a request that is
 * cancelled by `invalidate` (a later answer is dropped, for example when a workspace is archived); the
 * counter never overflowing in practice; keys that are removed once idle.
 * Test first: begin("w1") twice, then settle the first: isLatest is false for it and true for the second.
 */
import { notImplemented } from "@conducted/shared";

export interface LatestTicket<K extends string = string> {
	readonly key: K;
	readonly serial: number;
}

export interface LatestWins<K extends string = string> {
	/** Starts a request for `key`. Every earlier ticket for the key becomes stale. */
	begin(key: K): LatestTicket<K>;
	/** True when no newer request began and the key was not invalidated since. */
	isLatest(ticket: LatestTicket<K>): boolean;
	/** Makes every ticket of `key` stale without starting a new request. */
	invalidate(key: K): void;
}

export function createLatestWins<K extends string = string>(): LatestWins<K> {
	return notImplemented("APP-11");
}
