/**
 * @feature test support An id source that never repeats
 * Owns: `countingIds`, the id source sidecar tests pass in place of a constant. Each call hands out
 * the next id (`<prefix>-1`, `<prefix>-2`, ...), as the real random ids never repeat, so a test
 * cannot pass because two turns or messages shared one id. A dependency that takes a bare
 * `() => string` gets the source's `uuid`.
 * Behaviour: not applicable, test support only.
 * Must handle: every source counts on its own.
 * Test first: ids.test.ts, "hands out a new id on every call".
 */
import type { IdSource } from "@conducted/shared";

export function countingIds(prefix = "id"): IdSource {
	let next = 0;
	return { uuid: () => `${prefix}-${++next}` };
}
