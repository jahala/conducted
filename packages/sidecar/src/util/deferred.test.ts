/**
 * @feature AGENT-11 ACP client and runner: deferred values
 * Owns: tests for the shared deferred helper.
 * Test first: a deferred resolved after a tick yields the value to an earlier awaiter.
 */
import { describe, expect, test } from "bun:test";
import { createDeferred } from "./deferred.ts";

describe("AGENT-11 deferred values", () => {
	test("a value resolved after a tick reaches an earlier awaiter", async () => {
		const deferred = createDeferred<number>();
		const awaiting = deferred.promise;
		await Promise.resolve();
		deferred.resolve(7);
		expect(await awaiting).toBe(7);
	});
});
