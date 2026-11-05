/**
 * @feature AGENT-11 ACP client and runner: string-set comparison
 * Owns: tests for comparing string lists as sets.
 * Test first: ["a", "b"] and ["b", "a"] compare equal.
 */
import { describe, expect, test } from "bun:test";
import { sameStrings } from "./string-set.ts";

describe("AGENT-11 string-set comparison", () => {
	test("order does not matter", () => {
		expect(sameStrings(["a", "b"], ["b", "a"])).toBe(true);
	});

	test("a different length or a different value is unequal", () => {
		expect(sameStrings(["a"], ["a", "b"])).toBe(false);
		expect(sameStrings(["a", "b"], ["a", "c"])).toBe(false);
	});
});
