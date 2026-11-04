/**
 * @feature AGENT-02 Claude: Agent SDK in streaming-input mode
 * Owns: a push-based async queue that turns "push a value now" into "for await" iteration. Claude's
 * prompt stream and the ACP per-session event queue are built on it.
 * Behaviour: research/conductor/claude-runner.md section 1.1 (the prompt is an async iterable that
 * yields a user message whenever the app pushes one, so one `claude` process lives across turns).
 * Must handle: values pushed before anyone iterates (buffered in order), a consumer waiting when a
 * value arrives (resolved at once), close() ends iteration after the buffer drains, push after close
 * is refused (returns false), and a second concurrent consumer is a programmer error.
 * Test first: push "a" then "b" then close; for-await yields "a", "b" and ends.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
	private readonly buffer: T[] = [];
	private waiting: ((result: IteratorResult<T>) => void) | null = null;
	private closed = false;

	/** Adds a value. Returns false when the queue is closed and the value was dropped. */
	push(value: T): boolean {
		if (this.closed) return false;
		if (this.waiting) {
			const resolve = this.waiting;
			this.waiting = null;
			resolve({ value, done: false });
		} else {
			this.buffer.push(value);
		}
		return true;
	}

	/** Ends iteration once the buffered values have been read. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.waiting) {
			const resolve = this.waiting;
			this.waiting = null;
			resolve({ value: undefined, done: true });
		}
	}

	get isClosed(): boolean {
		return this.closed;
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				const value = this.buffer.shift();
				if (value !== undefined) return Promise.resolve({ value, done: false });
				if (this.closed) return Promise.resolve({ value: undefined, done: true });
				if (this.waiting) {
					throw new Error("AsyncQueue supports one consumer at a time");
				}
				return new Promise<IteratorResult<T>>((resolve) => {
					this.waiting = resolve;
				});
			},
		};
	}
}
