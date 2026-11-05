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
