/**
 * @feature REV-08 Find and replace in the editor
 * Tests the pattern, the match list and the literal replacement behind the find bar.
 */
import { describe, expect, it } from "vitest";
import { buildPattern, findMatches, replaceMatches } from "./find-matches.ts";

const replaceAll = (
	text: string,
	query: string,
	replacement: string,
	options: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } = {},
): { count: number; result: string } => {
	const { pattern } = buildPattern(
		query,
		options.caseSensitive ?? false,
		options.wholeWord ?? false,
		options.regex ?? false,
	);
	const matches = findMatches(text, pattern);
	return { count: matches.length, result: replaceMatches(text, matches, replacement) };
};

describe("REV-08 find and replace", () => {
	it("writes a dollar replacement as typed", () => {
		expect(replaceAll("banana", "a", "$1").result).toBe("b$1n$1n$1");
		expect(replaceAll("price", "price", "$$5").result).toBe("$$5");
		expect(replaceAll("one", "one", "$&!").result).toBe("$&!");
	});

	it("keeps the replacement literal in regex mode", () => {
		expect(replaceAll("banana", "n(a)", "[$1]", { regex: true }).result).toBe("ba[$1][$1]");
	});

	it("never counts or replaces an empty match", () => {
		const { count, result } = replaceAll("baa c", "a*", "X", { regex: true });
		expect(count).toBe(1);
		expect(result).toBe("bX c");
	});

	it("counts three matches of a in banana and replaces only the one given", () => {
		const { pattern } = buildPattern("a", false, false, false);
		const matches = findMatches("banana", pattern);
		expect(matches).toEqual([
			{ start: 1, end: 2 },
			{ start: 3, end: 4 },
			{ start: 5, end: 6 },
		]);
		const second = matches[1];
		expect(second).toBeDefined();
		if (second !== undefined) expect(replaceMatches("banana", [second], "o")).toBe("banona");
	});

	it("escapes special characters in a literal query and reports a bad regex", () => {
		expect(replaceAll("a.b axb", "a.b", "X").result).toBe("X axb");
		const invalid = buildPattern("(", false, false, true);
		expect(invalid.pattern).toBeNull();
		expect(invalid.error).not.toBeNull();
	});

	it("matches whole words only when asked", () => {
		expect(replaceAll("cat concat", "cat", "dog", { wholeWord: true }).result).toBe("dog concat");
	});
});
