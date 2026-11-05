/**
 * @feature APP-11 Serial queue per key
 * Owns: running async tasks one after another for one key (a chat, a database, a local file), or at the same
 * time with barriers that wait for everything before them.
 * Behaviour: services-map.md 1.5 (task queue `Ns`: type "serial" or "concurrent", tasks of type "barrier"),
 * 2.5.3 (write queues: one per chat, one per database for navigation sections, one for local-storage writes;
 * a barrier across several queues; a per-session promise chain that orders transcript writes), appendix copy
 * order 4 (a per-session serial queue, ack after persist).
 * Our design choice: a factory returns a queue object; the state lives in that object, never in the module
 * (docs/architecture.md, State and time). The container creates one per owner and passes it to services.
 * Must handle: a task that rejects (the next task still runs; the failure reaches only its own caller);
 * a task that returns a Result with ok false (the same: no effect on the queue); a barrier across several
 * keys (waits for the tasks queued before it on every key, blocks later ones until it ends); thousands of
 * keys (an idle key's queue is dropped, so memory does not grow); a caller that stops waiting (the task
 * still runs; the queue keeps order); two tasks queued in one tick (they run in the order queued).
 * Test first: three tasks queued on key "a" run in order even when the first is slowest; a failing first
 * task does not stop the second.
 */

export interface KeyedQueue<K extends string = string> {
	/** Runs `task` after every task already queued on `key`. Resolves or rejects with the task's outcome. */
	run<T>(key: K, task: () => Promise<T>): Promise<T>;
	/** Runs `task` once everything queued on each of `keys` is done, and holds them until it ends. */
	runBarrier<T>(keys: readonly K[], task: () => Promise<T>): Promise<T>;
	/** How many keys have work queued or running. For tests and the health view. */
	activeKeys(): number;
}

/** A tail that never rejects, so the next task always starts even when this one failed. */
const settle = (task: Promise<unknown>): Promise<void> =>
	task.then(
		() => undefined,
		() => undefined,
	);

export function createKeyedQueue<K extends string = string>(): KeyedQueue<K> {
	const tails = new Map<K, Promise<void>>();

	const enqueue = <T>(key: K, after: Promise<void>, task: () => Promise<T>): Promise<T> => {
		const result = after.then(task, task);
		const tail = settle(result);
		tails.set(key, tail);
		const clear = (): void => {
			if (tails.get(key) === tail) tails.delete(key);
		};
		void result.then(clear, clear);
		return result;
	};

	return {
		run: (key, task) => enqueue(key, tails.get(key) ?? Promise.resolve(), task),
		runBarrier: (keys, task) => {
			const unique = [...new Set(keys)];
			if (unique.length === 0) return task();
			const before = unique.map((key) => tails.get(key) ?? Promise.resolve());
			const after = Promise.all(before).then(() => undefined);
			const result = after.then(task, task);
			const tail = settle(result);
			for (const key of unique) tails.set(key, tail);
			const clear = (): void => {
				for (const key of unique) {
					if (tails.get(key) === tail) tails.delete(key);
				}
			};
			void result.then(clear, clear);
			return result;
		},
		activeKeys: () => tails.size,
	};
}
