/**
 * @feature APP-11 Latest wins
 * Owns: dropping an async answer that arrives after a newer request for the same key, so only the newest
 * result changes state.
 * Behaviour: docs/architecture.md, State and time ("Only the newest async result changes state"; UI services
 * drop query results whose request id is no longer the latest); backlog row APP-11 cites services-map.md 2.6.
 * This is the one helper those services share, so the rule has one home.
 * Our design choice: a ticket is a number from one counter shared by every key, so no clock or random id is
 * needed. A key's entry is removed when the caller settles its ticket or invalidates the key, and the
 * shared counter means an old ticket can never become latest again after that.
 * Must handle: two requests in flight for one key (only the second applies, whatever order they finish); an
 * older request that fails (its error is dropped too); different keys (independent); a request that is
 * cancelled by `invalidate` (a later answer is dropped, for example when a workspace is archived); the
 * counter never overflowing in practice; keys that are removed once idle.
 * Test first: begin("w1") twice, then settle the first: isLatest is false for it and true for the second.
 */

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
	/** Drops the key's entry once its latest ticket has been handled. Older tickets do nothing. */
	settle(ticket: LatestTicket<K>): void;
}

export function createLatestWins<K extends string = string>(): LatestWins<K> {
	let nextSerial = 1;
	const latest = new Map<K, number>();

	return {
		begin(key) {
			const serial = nextSerial;
			nextSerial += 1;
			latest.set(key, serial);
			return { key, serial };
		},
		isLatest: (ticket) => latest.get(ticket.key) === ticket.serial,
		invalidate: (key) => {
			latest.delete(key);
		},
		settle: (ticket) => {
			if (latest.get(ticket.key) === ticket.serial) latest.delete(ticket.key);
		},
	};
}
