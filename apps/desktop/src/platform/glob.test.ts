/**
 * @feature WS-03 The shared gitignore-style glob rule
 * Owns: tests for `globToRegExp`, which the file-copy matcher and the in-memory gitignore reader use.
 * Behaviour: services-map.md 3.1 and 5A.5.5; gitignore reads a `**` segment before a slash as zero
 * or more folders.
 * Test first: the pattern for "a", any folders, "b" matches "a/b".
 */
import { describe, expect, it } from "vitest";
import { globToRegExp } from "./glob.ts";

describe("WS-03 globToRegExp", () => {
	it("keeps * inside one folder and lets a trailing ** cross folders", () => {
		expect(globToRegExp("config/**").test("config/nested/app.json")).toBe(true);
		expect(globToRegExp("config/*.json").test("config/nested/app.json")).toBe(false);
		expect(globToRegExp("config/*.json").test("config/app.json")).toBe(true);
		expect(globToRegExp("file?.txt").test("file1.txt")).toBe(true);
		expect(globToRegExp("file?.txt").test("file/.txt")).toBe(false);
	});

	it("reads a ** segment before a slash as zero or more folders", () => {
		const middle = globToRegExp(["a", "**", "b"].join("/"));
		expect(middle.test("a/b")).toBe(true);
		expect(middle.test("a/x/b")).toBe(true);
		expect(middle.test("a/x/y/b")).toBe(true);
		expect(middle.test("ab")).toBe(false);

		const leading = globToRegExp(["**", ".env"].join("/"));
		expect(leading.test(".env")).toBe(true);
		expect(leading.test("apps/web/.env")).toBe(true);
		expect(leading.test("x.env")).toBe(false);
	});

	it("keeps ** inside a name as any text", () => {
		expect(globToRegExp("a**b").test("a/x/b")).toBe(true);
	});
});
