/**
 * @feature AGENT-09 Cursor: environment lock
 * Owns: running a function while process.env holds one chat's variables, one chat at a time.
 * Behaviour: research/conductor/other-runners.md section 2.3: the Cursor SDK reads process.env, so
 * Conductor changes it for the duration of a call under a serial queue and restores it afterwards.
 * Must handle: the previous values are restored even when the function throws, variables that did
 * not exist are removed again (not set to the empty string), two chats never see each other's
 * variables, and a long-running function holds the lock, so only the start of a run (where the SDK
 * reads the environment) goes inside it, not the whole stream.
 * Test first: two calls with different env values run one after the other and process.env has its
 * original value afterwards.
 * Our design choice: the target environment object is a parameter (process.env in production), so
 * the test uses a plain object.
 */
import type { KeyedQueue } from "@conducted/shared";

/** One queue key, so every Cursor SDK call waits for the one before it. */
const ENV_LOCK_KEY = "cursor";

export class EnvLock {
	constructor(
		protected readonly deps: {
			queue: KeyedQueue;
			target: Record<string, string | undefined>;
		},
	) {}

	withEnv<T>(env: Readonly<Record<string, string>>, fn: () => Promise<T>): Promise<T> {
		return this.deps.queue.run(ENV_LOCK_KEY, async () => {
			const previous = new Map<string, string | undefined>();
			for (const [name, value] of Object.entries(env)) {
				previous.set(name, this.deps.target[name]);
				this.deps.target[name] = value;
			}
			try {
				return await fn();
			} finally {
				for (const [name, value] of previous) {
					if (value === undefined) delete this.deps.target[name];
					else this.deps.target[name] = value;
				}
			}
		});
	}
}
