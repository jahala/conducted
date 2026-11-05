/**
 * @feature APP-11 Fire and forget
 * Owns: marking work that starts without a caller waiting for it, so it is not a floating promise, and
 * making sure a failure in that work still reaches the caller's reporter.
 * Behaviour: services-map.md 1.5 (`.fireAndForget()` marks a deliberate unawaited promise), 2.5.2
 * (query invalidations are fire and forget; the caller does not wait for the refetch).
 * Our design choice: the work is a thunk, so a synchronous throw is reported the same way as a rejected
 * promise. The caller supplies the reporter; the helper never swallows an error silently.
 * Must handle: a rejected task (reported once); a task that throws before returning a promise (reported
 * once); a task that succeeds (nothing reported); the caller continuing without waiting.
 * Test first: a rejecting invalidation is reported while the caller's next awaited step runs first.
 */

export type FireAndForgetReport = (error: unknown) => void;

/** Starts `work` without waiting. Its failure goes to `onError` instead of becoming unhandled. */
export function fireAndForget<T>(work: () => Promise<T>, onError: FireAndForgetReport): void {
	let result: Promise<T>;
	try {
		result = work();
	} catch (error) {
		onError(error);
		return;
	}
	void result.then(undefined, onError);
}
