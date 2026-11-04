/**
 * @feature GIT-01 Named locks for git work
 * Owns: an in-process mutex per key, so two git commands that write the same worktree or the same
 * repository never run at the same time.
 * Behaviour: services-map.md 3.0.3 (locking model: `worktree:<path>` and `repo:<mainPath>`, in
 * process only, no lock file on disk).
 * Must handle: a failing task releases the lock; waiters run in the order they asked; a lock
 * with no waiters is dropped from the map (no growth); the repo lock is taken inside the
 * worktree lock, never the other way round (callers keep that order).
 * Test first: two tasks on one key run one after the other; two keys run together.
 */

export class KeyedMutex {
	readonly #tails = new Map<string, Promise<unknown>>();

	/** Runs `work` once every earlier task on `key` has settled. */
	run<T>(key: string, work: () => Promise<T>): Promise<T> {
		const previous = this.#tails.get(key) ?? Promise.resolve();
		const result = previous.then(work, work);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.#tails.set(key, tail);
		void tail.then(() => {
			if (this.#tails.get(key) === tail) this.#tails.delete(key);
		});
		return result;
	}

	/** Number of keys that currently hold or wait for the lock. */
	get size(): number {
		return this.#tails.size;
	}
}

export const worktreeLockKey = (worktreePath: string): string => `worktree:${worktreePath}`;
export const repoLockKey = (repoRootPath: string): string => `repo:${repoRootPath}`;
