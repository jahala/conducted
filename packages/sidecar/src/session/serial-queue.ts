/**
 * @feature SIDE-03 Session manager: per-session queue
 * Owns: running async jobs one at a time per key. The session manager keys it by session id so
 * two messages for the same chat never race. Other keys run in parallel.
 * Behaviour: research/conductor/sessions.md section 2 (`query` and `steer` run on a serial queue
 * per session; `cancel` is deliberately not on it).
 * Must handle: a job that throws or rejects (the queue moves on, the caller still gets the
 * rejection), jobs queued while another runs (strict arrival order), the same job result for the
 * caller, and no memory kept for a key once its queue is empty.
 * Test first: three jobs on one key finish in arrival order even if the first is slowest.
 */
export class KeyedSerialQueue {
	private readonly tails = new Map<string, Promise<unknown>>();

	/** Runs `job` after every earlier job of the same key has settled. */
	run<T>(key: string, job: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve();
		const result = previous.then(job, job);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(key, tail);
		void tail.then(() => {
			if (this.tails.get(key) === tail) this.tails.delete(key);
		});
		return result;
	}

	/** Number of keys with work queued or running. For tests and diagnostics. */
	get activeKeys(): number {
		return this.tails.size;
	}
}
