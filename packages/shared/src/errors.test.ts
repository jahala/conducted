import { describe, expect, test } from "bun:test";
import { asAppError, isAppError, isMissingFile, messageOf } from "./errors.ts";

describe("SIDE-01 error helpers", () => {
	test("SIDE-01 messageOf reads an Error's message and stringifies anything else", () => {
		expect(messageOf(new Error("boom"))).toBe("boom");
		expect(messageOf("plain")).toBe("plain");
		expect(messageOf(42)).toBe("42");
		expect(messageOf(undefined)).toBe("undefined");
	});

	test("SIDE-21 messageOf reads a thrown AppError's message, as runners throw one from start", () => {
		expect(
			messageOf({ code: "agent_program_invalid", message: "The program at /x cannot run." }),
		).toBe("The program at /x cannot run.");
	});

	test("messageOf reads the message of a thrown object that has one, as the database plugin throws", () => {
		expect(messageOf({ message: "UNIQUE constraint failed: repos.root_path" })).toBe(
			"UNIQUE constraint failed: repos.root_path",
		);
		expect(messageOf({ message: 7 })).toBe("[object Object]");
	});

	test("SIDE-01 isAppError accepts a code and a message, and refuses look-alikes", () => {
		expect(isAppError({ code: "x", message: "y" })).toBe(true);
		expect(isAppError({ code: "x" })).toBe(false);
		expect(isAppError({ code: 1, message: "y" })).toBe(false);
		expect(isAppError(new Error("y"))).toBe(false);
		expect(isAppError(null)).toBe(false);
		expect(isAppError("x")).toBe(false);
	});

	test("SIDE-01 asAppError keeps an AppError and wraps anything else under the code", () => {
		const original = { code: "agent_not_installed", message: "missing" };
		expect(asAppError("wrapped", "Could not", original)).toBe(original);
		const wrapped = asAppError("wrapped", "Could not", new Error("boom"));
		expect(wrapped.code).toBe("wrapped");
		expect(wrapped.message).toBe("Could not: boom");
	});

	test("SIDE-01 isMissingFile is true for ENOENT only", () => {
		expect(isMissingFile(Object.assign(new Error("gone"), { code: "ENOENT" }))).toBe(true);
		expect(isMissingFile(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
		expect(isMissingFile(new Error("plain"))).toBe(false);
		expect(isMissingFile(null)).toBe(false);
	});
});
