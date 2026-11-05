import { describe, expect, test } from "bun:test";
import { AsyncQueue } from "./async-queue.ts";

async function collect<T>(queue: AsyncQueue<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const value of queue) out.push(value);
	return out;
}

test("values pushed before iteration are yielded in order, then iteration ends on close", async () => {
	const queue = new AsyncQueue<string>();
	queue.push("a");
	queue.push("b");
	queue.close();
	expect(await collect(queue)).toEqual(["a", "b"]);
});

test("a waiting consumer is woken by a later push and by close", async () => {
	const queue = new AsyncQueue<number>();
	const result = collect(queue);
	queue.push(1);
	queue.push(2);
	queue.close();
	expect(await result).toEqual([1, 2]);
});

test("push after close is refused", () => {
	const queue = new AsyncQueue<number>();
	queue.close();
	expect(queue.push(1)).toBe(false);
	expect(queue.isClosed).toBe(true);
});

describe("AGENT-02 async queue", () => {
	test("a buffered undefined value is still a value, not the end of the queue", async () => {
		const queue = new AsyncQueue<number | undefined>();
		queue.push(undefined);
		queue.push(2);
		queue.close();

		expect(await collect(queue)).toEqual([undefined, 2]);
	});

	test("a second consumer is refused", async () => {
		const queue = new AsyncQueue<number>();
		const first = queue[Symbol.asyncIterator]();
		expect(() => queue[Symbol.asyncIterator]()).toThrow(
			"AsyncQueue supports one consumer at a time",
		);
		queue.push(1);
		queue.close();
		expect(await first.next()).toEqual({ value: 1, done: false });
		expect(await first.next()).toEqual({ value: undefined, done: true });
	});
});

/** Resolves with "hung" when the promise has not settled after a second, so a lost wake-up fails fast. */
async function settledOrHung<T>(promise: Promise<T>): Promise<T | "hung"> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const hung = new Promise<"hung">((resolve) => {
		timer = setTimeout(() => resolve("hung"), 1000);
	});
	try {
		return await Promise.race([promise, hung]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

describe("AGENT-02 async queue wake-ups", () => {
	test("close wakes a consumer that is already waiting, and the queue then reports done", async () => {
		const queue = new AsyncQueue<number>();
		const iterator = queue[Symbol.asyncIterator]();
		const waiting = iterator.next();

		queue.close();

		expect(await settledOrHung(waiting)).toEqual({ value: undefined, done: true });
		expect(await iterator.next()).toEqual({ value: undefined, done: true });
	});

	test("a push goes straight to a waiting consumer and is not delivered twice", async () => {
		const queue = new AsyncQueue<number>();
		const iterator = queue[Symbol.asyncIterator]();
		const waiting = iterator.next();

		queue.push(7);

		expect(await settledOrHung(waiting)).toEqual({ value: 7, done: false });
		queue.push(8);
		queue.close();
		expect(await iterator.next()).toEqual({ value: 8, done: false });
		expect(await iterator.next()).toEqual({ value: undefined, done: true });
	});

	test("closing twice wakes nobody a second time and keeps buffered values readable", async () => {
		const queue = new AsyncQueue<string>();
		queue.push("kept");
		queue.close();
		queue.close();

		expect(await collect(queue)).toEqual(["kept"]);
	});
});
