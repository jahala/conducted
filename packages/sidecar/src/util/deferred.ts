/**
 * @feature AGENT-11 ACP client and runner: deferred values
 * Owns: a promise a later event resolves, with its resolve function.
 * Behaviour: research/conductor/other-runners.md section 2.2: an ACP turn settles when the prompt
 * answer arrives, not when the call is made, so the session holds the resolvers.
 * Must handle: the resolver exists before any caller awaits the promise.
 * Test first: a deferred resolved after a tick yields the value to an earlier awaiter.
 * Our design choice: one home for the ACP, Codex and Claude sessions, which each wait on answers
 * that arrive later (a prompt answer, turn/completed, the result message).
 */
export interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

export function createDeferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}
