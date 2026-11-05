import { describe, expect, test } from "bun:test";
import { isAppError, messageOf } from "./errors.ts";

describe("SIDE-01 error helpers", () => {
	test("SIDE-01 messageOf reads an Error's message and stringifies anything else", () => {
		expect(messageOf(new Error("boom"))).toBe("boom");
		expect(messageOf("plain")).toBe("plain");
		expect(messageOf(42)).toBe("42");
		expect(messageOf(undefined)).toBe("undefined");
	});

	test("SIDE-01 isAppError accepts a code and a message, and refuses look-alikes", () => {
		expect(isAppError({ code: "x", message: "y" })).toBe(true);
		expect(isAppError({ code: "x" })).toBe(false);
		expect(isAppError({ code: 1, message: "y" })).toBe(false);
		expect(isAppError(new Error("y"))).toBe(false);
		expect(isAppError(null)).toBe(false);
		expect(isAppError("x")).toBe(false);
	});
});
