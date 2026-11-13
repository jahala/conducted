/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the trailing-slash trim the Worker runs on URLs from the sandbox and from providers: the
 * same answers as the old `/\/+$/` replace, and work in proportion to the slashes it removes, so
 * a long run of slashes cannot make it slow (CodeQL `js/polynomial-redos`).
 * Test first: reads each character once, however many slashes the text holds.
 */
import { describe, expect, test } from "bun:test";
import { trailingSlashCount, trimLeadingSlashes, trimTrailingSlashes } from "./trailing-slashes.ts";

describe("CLOUD-17 trimming trailing slashes", () => {
	test("gives the same answers as the old pattern", () => {
		for (const text of ["", "/", "///", "/mcp", "/mcp/", "/mcp///", "a//b//", "https://x/"]) {
			expect(trimTrailingSlashes(text)).toBe(text.replace(/\/+$/, ""));
		}
	});

	test("reads each character once, however many slashes the text holds", () => {
		const reads = (text: string): number => {
			let count = 0;
			const removed = trailingSlashCount(text.length, (index) => {
				count += 1;
				return text.charCodeAt(index) === 47;
			});
			expect(removed).toBe(text.length - trimTrailingSlashes(text).length);
			return count;
		};
		const slashes = "/".repeat(100_000);
		// The text the old pattern took quadratic time on: slashes that do not end it.
		expect(reads(`${slashes}x`)).toBe(1);
		expect(trimTrailingSlashes(`${slashes}x`)).toBe(`${slashes}x`);
		// Slashes to the end: each is read once, then the text is empty.
		expect(reads(slashes)).toBe(100_000);
		expect(trimTrailingSlashes(slashes)).toBe("");
		expect(reads(`x${slashes}`)).toBe(100_001);
	});

	test("trims leading slashes with the same answers as the old pattern", () => {
		for (const text of ["", "/", "///", "mcp", "/mcp", "///mcp/", "a//b", "//a//"]) {
			expect(trimLeadingSlashes(text)).toBe(text.replace(/^\/+/, ""));
		}
	});
});
