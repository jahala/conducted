/**
 * @feature catalogue The catalogue's fixed time
 * Owns: the moment every catalogue state is drawn at, and the units seeds count back from it.
 * The app's clock (world.ts) returns it, and the screenshot run (scripts/catalogue/shots.ts) fixes the
 * page's `Date` to it, because the sidebar and Home read the time with `Date.now` (features/sidebar/
 * use-now.ts) rather than the app's clock.
 * Test first: not applicable; it holds values only.
 */

/** Monday 2 November 2026, 09:30 UTC. */
export const CATALOGUE_NOW = Date.UTC(2026, 10, 2, 9, 30);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
