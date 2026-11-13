import { describe, expect, test } from "bun:test";
import { LineSplitter } from "./lines.ts";

describe("SIDE-02 the shared line splitter", () => {
	test("a line split over chunks comes back once, whole", () => {
		const lines = new LineSplitter();
		expect(lines.push("ab")).toEqual([]);
		expect(lines.pendingChars).toBe(2);
		expect(lines.push("cd")).toEqual([]);
		expect(lines.push("e\nf")).toEqual(["abcde"]);
		expect(lines.pendingChars).toBe(1);
		expect(lines.push("\n")).toEqual(["f"]);
		expect(lines.pendingChars).toBe(0);
	});

	test("several lines in one chunk, empty lines and a chunk ending on its newline", () => {
		const lines = new LineSplitter();
		expect(lines.push("a\n\nb\r\nc\n")).toEqual(["a", "", "b\r", "c"]);
		expect(lines.pendingChars).toBe(0);
	});

	test("a discarded unfinished line leaves only what follows its newline", () => {
		const lines = new LineSplitter();
		lines.push("too long");
		lines.discard();
		expect(lines.pendingChars).toBe(0);
		expect(lines.push(" tail\nnext\n")).toEqual([" tail", "next"]);
	});
});
