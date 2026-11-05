/**
 * @feature APP-11 Single flight
 * Owns: making one action run once when it is asked for twice at the same time (merge, push, pull,
 * rename, approve, mark ready, auto-merge, edit, sync).
 * Behaviour: services-map.md 1.5 (dedupe helper `Xn()`: `renameBranchDedupe`, `pushDedupe`, `mergePrDedupe`
 * collapse concurrent identical calls), 3.0.3 (per-action dedupe for rename, push, pull, syncStack, merge,
 * approve, enableAutoMerge, disableAutoMerge, markReady, updatePrMetadata, updatePrBase, editReviewers),
 * 5B.1.1 and 5B.1.7 (the workspace actions controller dedupes each PR action while one runs).
 * Our design choice: the second caller gets the first caller's promise, so both see the same outcome. A call
 * after the first has finished starts a new run. The key says what counts as "the same": for example
 * "merge:<workspaceId>". Arguments that change the meaning (a new title) belong in the key.
 * Must handle: the first run fails (both callers see the failure, and the next call starts fresh); a
 * different key at the same time (runs independently); a task that throws before returning a promise (the
 * flight still ends); a caller that gives up (the run goes on for the others); the key set never growing
 * (a finished key is removed).
 * Test first: two calls with key "merge:w1" while the first is pending run the task once and resolve to the
 * same value; a third call after they finish runs it again.
 */
import { notImplemented } from "@conducted/shared";

export interface SingleFlight<K extends string = string> {
	run<T>(key: K, task: () => Promise<T>): Promise<T>;
	/** True while a run for `key` is in flight. For disabling a button. */
	isRunning(key: K): boolean;
}

export function createSingleFlight<K extends string = string>(): SingleFlight<K> {
	return notImplemented("APP-11");
}
