import { describe, expect, it } from "vitest";
import { createSingleFlight } from "./single-flight.ts";

const deferred = <T = void>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

describe("APP-11 single flight", () => {
	it("runs an action once for two callers and again after it finishes", async () => {
		const flight = createSingleFlight<"merge:w1">();
		const gate = deferred<string>();
		let calls = 0;
		const task = () => {
			calls += 1;
			return gate.promise;
		};

		const first = flight.run("merge:w1", task);
		const second = flight.run("merge:w1", task);

		expect(flight.isRunning("merge:w1")).toBe(true);
		expect(calls).toBe(1);

		gate.resolve("merged");
		await expect(first).resolves.toBe("merged");
		await expect(second).resolves.toBe("merged");
		expect(flight.isRunning("merge:w1")).toBe(false);

		const third = flight.run("merge:w1", async () => {
			calls += 1;
			return "again";
		});
		await expect(third).resolves.toBe("again");
		expect(calls).toBe(2);
	});

	it("shares a failure and starts fresh afterwards", async () => {
		const flight = createSingleFlight();
		const gate = deferred();
		let calls = 0;

		const failing = () => {
			calls += 1;
			return gate.promise.then(() => {
				throw new Error("no");
			});
		};
		const first = flight.run("push:w1", failing);
		const second = flight.run("push:w1", failing);

		gate.resolve();
		await expect(first).rejects.toThrow("no");
		await expect(second).rejects.toThrow("no");
		expect(calls).toBe(1);
		await expect(flight.run("push:w1", async () => "ok")).resolves.toBe("ok");
	});

	it("runs different keys independently", async () => {
		const flight = createSingleFlight();
		const gate = deferred();
		let a = 0;
		let b = 0;

		const pa = flight.run("merge:a", async () => {
			a += 1;
			await gate.promise;
			return "a";
		});
		const pb = flight.run("merge:b", async () => {
			b += 1;
			await gate.promise;
			return "b";
		});

		gate.resolve();
		await expect(Promise.all([pa, pb])).resolves.toEqual(["a", "b"]);
		expect([a, b]).toEqual([1, 1]);
	});

	it("ends the flight when the task throws before returning a promise", async () => {
		const flight = createSingleFlight();
		const first = flight.run("rename:w1", () => {
			throw new Error("sync");
		});

		await expect(first).rejects.toThrow("sync");
		expect(flight.isRunning("rename:w1")).toBe(false);
		await expect(flight.run("rename:w1", async () => "ok")).resolves.toBe("ok");
	});

	it("keeps running for the caller who waits when another gives up", async () => {
		const flight = createSingleFlight();
		const gate = deferred<string>();
		const ignored = flight.run("pull:w1", () => gate.promise);
		const waiting = flight.run("pull:w1", () => gate.promise);

		gate.resolve("done");
		await expect(waiting).resolves.toBe("done");
		await expect(ignored).resolves.toBe("done");
		expect(flight.isRunning("pull:w1")).toBe(false);
	});
});
