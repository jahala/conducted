import { expect, test } from "bun:test";
import { KeyedSerialQueue } from "./serial-queue.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

test("jobs on one key run in arrival order even when the first is slowest", async () => {
	const queue = new KeyedSerialQueue();
	const order: string[] = [];
	const gate = deferred();
	const a = queue.run("s", async () => {
		await gate.promise;
		order.push("a");
	});
	const b = queue.run("s", async () => {
		order.push("b");
	});
	const c = queue.run("s", async () => {
		order.push("c");
	});
	gate.resolve();
	await Promise.all([a, b, c]);
	expect(order).toEqual(["a", "b", "c"]);
});

test("a rejected job does not stop the next one, and its caller sees the rejection", async () => {
	const queue = new KeyedSerialQueue();
	const failing = queue.run("s", async () => {
		throw new Error("boom");
	});
	const next = queue.run("s", async () => "ok");
	await expect(failing).rejects.toThrow("boom");
	expect(await next).toBe("ok");
});

test("different keys do not wait for each other and leave no state behind", async () => {
	const queue = new KeyedSerialQueue();
	const gate = deferred();
	const slow = queue.run("one", () => gate.promise);
	const fast = await queue.run("two", async () => "done");
	expect(fast).toBe("done");
	gate.resolve();
	await slow;
	await Promise.resolve();
	await Promise.resolve();
	expect(queue.activeKeys).toBe(0);
});
