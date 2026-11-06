/**
 * @feature AGENT-09 Cursor: environment lock
 * Owns: tests for running Cursor SDK work under one chat's environment, one chat at a time.
 * Test first: two calls with different env values run one after the other and process.env has its
 * original value afterwards.
 */
import { describe, expect, test } from "bun:test";
import { createKeyedQueue } from "@conducted/shared";
import { createDeferred } from "../../util/deferred.ts";
import { EnvLock } from "./env-lock.ts";

describe("AGENT-09 Cursor environment lock", () => {
	test("two calls with different env values run one after the other and the target is restored", async () => {
		const target: Record<string, string | undefined> = {
			KEEP: "original",
			CURSOR_API_KEY: "from-the-mac",
		};
		const lock = new EnvLock({ queue: createKeyedQueue(), target });
		const firstStarted = createDeferred<void>();
		const releaseFirst = createDeferred<void>();
		const order: string[] = [];
		const seen: (string | undefined)[] = [];

		const first = lock.withEnv({ CURSOR_API_KEY: "one", NEW_VALUE: "x" }, async () => {
			order.push("first:start");
			seen.push(target.CURSOR_API_KEY);
			expect(target.NEW_VALUE).toBe("x");
			firstStarted.resolve();
			await releaseFirst.promise;
			order.push("first:end");
			return "a";
		});
		await firstStarted.promise;

		const second = lock.withEnv({ CURSOR_API_KEY: "two" }, async () => {
			order.push("second:start");
			seen.push(target.CURSOR_API_KEY);
			expect(target.NEW_VALUE).toBeUndefined();
			return "b";
		});
		await Promise.resolve();
		expect(order).toEqual(["first:start"]);

		releaseFirst.resolve();
		expect(await first).toBe("a");
		expect(await second).toBe("b");
		expect(order).toEqual(["first:start", "first:end", "second:start"]);
		expect(seen).toEqual(["one", "two"]);
		expect(target.CURSOR_API_KEY).toBe("from-the-mac");
		expect(target.NEW_VALUE).toBeUndefined();
		expect(target.KEEP).toBe("original");
	});

	test("a function that throws still puts every variable back", async () => {
		const target: Record<string, string | undefined> = { PRESENT: "before" };
		const lock = new EnvLock({ queue: createKeyedQueue(), target });

		await expect(
			lock.withEnv({ PRESENT: "during", ABSENT: "added" }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		expect(target.PRESENT).toBe("before");
		expect(target.ABSENT).toBeUndefined();
	});
});
