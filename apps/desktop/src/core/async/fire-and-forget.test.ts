import { describe, expect, it } from "vitest";
import { fireAndForget } from "./fire-and-forget.ts";

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

describe("APP-11 fire and forget", () => {
	it("starts an invalidation without making the caller wait for it", async () => {
		const gate = deferred();
		const log: string[] = [];
		const reported: unknown[] = [];

		fireAndForget(
			async () => {
				log.push("invalidate:start");
				await gate.promise;
				log.push("invalidate:end");
			},
			(error) => {
				reported.push(error);
			},
		);
		log.push("caller continues");

		expect(log).toEqual(["invalidate:start", "caller continues"]);

		gate.resolve();
		await flush();
		expect(log).toEqual(["invalidate:start", "caller continues", "invalidate:end"]);
		expect(reported).toEqual([]);
	});

	it("reports a rejection instead of leaving it unhandled", async () => {
		const gate = deferred();
		const reported: unknown[] = [];

		fireAndForget(
			async () => {
				await gate.promise;
				throw new Error("refetch failed");
			},
			(error) => {
				reported.push(error);
			},
		);

		expect(reported).toEqual([]);
		gate.resolve();
		await flush();
		expect(reported).toHaveLength(1);
		expect((reported[0] as Error).message).toBe("refetch failed");
	});

	it("reports a task that throws before returning a promise", () => {
		const reported: unknown[] = [];

		fireAndForget(
			() => {
				throw new Error("sync failed");
			},
			(error) => {
				reported.push(error);
			},
		);

		expect(reported).toHaveLength(1);
		expect((reported[0] as Error).message).toBe("sync failed");
	});
});
