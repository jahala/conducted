import { describe, expect, test } from "bun:test";
import { countingIds } from "./ids.ts";

describe("countingIds", () => {
	test("hands out a new id on every call, and each source counts on its own", () => {
		const ids = countingIds("turn");
		const next = ids.uuid;
		expect([next(), next(), ids.uuid()]).toEqual(["turn-1", "turn-2", "turn-3"]);
		expect(countingIds("turn").uuid()).toBe("turn-1");
	});
});
