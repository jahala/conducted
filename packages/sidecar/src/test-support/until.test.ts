import { describe, expect, test } from "bun:test";
import { until } from "./until.ts";

describe("until", () => {
	test("waits for a condition that becomes true on a later task", async () => {
		let ready = false;
		setTimeout(() => {
			ready = true;
		}, 0);
		await until(() => ready, "the flag");
		expect(ready).toBe(true);
	});

	test("fails with what it waited for when the condition never holds", async () => {
		await expect(until(() => false, "the chat to be idle", 20)).rejects.toThrow(
			"Timed out waiting for the chat to be idle",
		);
	});
});
