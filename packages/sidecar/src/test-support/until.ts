/**
 * @feature test support Waiting for a condition
 * Owns: `until`, the one helper sidecar tests use to wait for something to become true: it yields a
 * macrotask at a time, so promise chains and timers set to 0 can run, and fails after a deadline
 * with what it waited for, so a broken test reports instead of hanging. Tests used to keep their
 * own copies, two of them with no deadline.
 * Behaviour: not applicable, test support only.
 * Must handle: a condition that is already true (no wait); one that never holds (a named error).
 * Test first: until.test.ts, "fails with what it waited for when the condition never holds".
 */

export async function until(
	check: () => boolean,
	description = "the condition",
	withinMs = 2000,
): Promise<void> {
	const deadline = Date.now() + withinMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}
