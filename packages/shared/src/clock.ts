/**
 * Time and id sources are passed in, never read from globals, so tests can control them.
 */
export interface Clock {
	/** Milliseconds since the Unix epoch. */
	now(): number;
}

export interface IdSource {
	/** A new UUID v4. */
	uuid(): string;
}

export const systemClock: Clock = { now: () => Date.now() };
export const cryptoIds: IdSource = { uuid: () => crypto.randomUUID() };
