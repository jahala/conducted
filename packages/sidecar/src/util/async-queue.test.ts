import { expect, test } from "bun:test";
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
