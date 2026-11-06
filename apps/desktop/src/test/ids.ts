/**
 * @feature test support An id source that never repeats
 * Owns: `createTestIds`, the id source every desktop test passes in place of a constant. Each
 * call hands out the next id (`<prefix>-1`, `<prefix>-2`, ...), as the app's random ids never
 * repeat, so a test cannot pass because two rows, turns or terminals shared one id.
 * Behaviour: not applicable, test support only.
 * Must handle: every source counts on its own, so two containers in one test never share a counter.
 * Test first: two ids from one source differ.
 */
import type { IdSource } from "@conducted/shared";

export function createTestIds(prefix = "test-id"): IdSource {
	let next = 0;
	return { uuid: () => `${prefix}-${++next}` };
}
