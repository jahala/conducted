import { describe, expect, it } from "vitest";
import { createKeyedQueue } from "./serial-queue.ts";

const deferred = <T = void>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
	for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

describe("APP-11 serial queue", () => {
	it("runs three tasks on one key in order even when the first is slowest", async () => {
		const queue = createKeyedQueue<"a">();
		const gate = deferred();
		const log: string[] = [];

		const first = queue.run("a", async () => {
			log.push("1:start");
			await gate.promise;
			log.push("1:end");
			return 1;
		});
		const second = queue.run("a", async () => {
			log.push("2");
			return 2;
		});
		const third = queue.run("a", async () => {
			log.push("3");
			return 3;
		});

		await flush();
		expect(log).toEqual(["1:start"]);

		gate.resolve();
		await expect(Promise.all([first, second, third])).resolves.toEqual([1, 2, 3]);
		expect(log).toEqual(["1:start", "1:end", "2", "3"]);
	});

	it("keeps going after a task rejects", async () => {
		const queue = createKeyedQueue();
		const gate = deferred();
		const seen: string[] = [];

		const first = queue.run("a", async () => {
			await gate.promise;
			throw new Error("boom");
		});
		const second = queue.run("a", async () => {
			seen.push("second");
			return "ok";
		});

		gate.resolve();
		await expect(first).rejects.toThrow("boom");
		await expect(second).resolves.toBe("ok");
		expect(seen).toEqual(["second"]);
	});

	it("does not let a failed Result affect the next task", async () => {
		const queue = createKeyedQueue();
		const failed = await queue.run("a", async () => ({ ok: false as const, error: "no" }));
		const next = await queue.run("a", async () => "next");
		expect(failed.ok).toBe(false);
		expect(next).toBe("next");
	});

	it("runs different keys in parallel", async () => {
		const queue = createKeyedQueue();
		const gateA = deferred();
		const gateB = deferred();
		const started: string[] = [];

		const a = queue.run("a", async () => {
			started.push("a");
			await gateA.promise;
		});
		const b = queue.run("b", async () => {
			started.push("b");
			await gateB.promise;
		});

		await flush();
		expect(started).toEqual(["a", "b"]);
		gateA.resolve();
		gateB.resolve();
		await Promise.all([a, b]);
	});

	it("makes a barrier wait for every named key and block later work until it ends", async () => {
		const queue = createKeyedQueue();
		const gateA = deferred();
		const gateB = deferred();
		const gateBarrier = deferred();
		const log: string[] = [];

		const a = queue.run("a", async () => {
			log.push("a:start");
			await gateA.promise;
			log.push("a:end");
		});
		const b = queue.run("b", async () => {
			log.push("b:start");
			await gateB.promise;
			log.push("b:end");
		});
		const barrier = queue.runBarrier(["a", "b"], async () => {
			log.push("barrier:start");
			await gateBarrier.promise;
			log.push("barrier:end");
		});
		const after = queue.run("a", async () => {
			log.push("after");
		});

		await flush();
		expect(log).toEqual(["a:start", "b:start"]);

		gateA.resolve();
		await a;
		await flush();
		expect(log).toEqual(["a:start", "b:start", "a:end"]);

		gateB.resolve();
		await b;
		await flush();
		expect(log).toEqual(["a:start", "b:start", "a:end", "b:end", "barrier:start"]);

		gateBarrier.resolve();
		await Promise.all([barrier, after]);
		expect(log).toEqual([
			"a:start",
			"b:start",
			"a:end",
			"b:end",
			"barrier:start",
			"barrier:end",
			"after",
		]);
	});

	it("runs a barrier with no keys at once", async () => {
		const queue = createKeyedQueue();
		await expect(queue.runBarrier([], async () => "now")).resolves.toBe("now");
	});

	it("drops idle keys from activeKeys", async () => {
		const queue = createKeyedQueue();
		expect(queue.activeKeys()).toBe(0);
		await queue.run("a", async () => 1);
		await queue.run("b", async () => 2);
		await flush();
		expect(queue.activeKeys()).toBe(0);
	});

	it("runs a task even when its caller stops waiting", async () => {
		const queue = createKeyedQueue();
		const log: string[] = [];
		void queue.run("a", async () => {
			log.push("first");
		});
		const second = queue.run("a", async () => {
			log.push("second");
			return 2;
		});
		await expect(second).resolves.toBe(2);
		expect(log).toEqual(["first", "second"]);
	});
});
