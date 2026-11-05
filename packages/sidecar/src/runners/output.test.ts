import { describe, expect, test } from "bun:test";
import { contentToText, MAX_TOOL_OUTPUT_CHARS, truncateOutput } from "./output.ts";

describe("AGENT-03 shared output helpers", () => {
	test("output over the limit keeps its head and tail; output at the limit is kept whole", () => {
		const headOnly = truncateOutput("a".repeat(10), 4);
		expect(headOnly.output).toBe("aaaa");
		expect(headOnly.truncated).toBe(true);
		expect(headOnly.originalLength).toBe(10);

		expect(truncateOutput("abcd", 4)).toEqual({ output: "abcd", truncated: false });
	});

	test("a large cut keeps the end so a final error survives, and says how much was removed", () => {
		const text = `${"start ".repeat(20)}THE END`;
		const cut = truncateOutput(text, 80);
		expect(cut.truncated).toBe(true);
		expect(cut.originalLength).toBe(text.length);
		expect(cut.output.startsWith("start ")).toBe(true);
		expect(cut.output.endsWith("THE END")).toBe(true);
		expect(cut.output).toContain("characters cut");
	});

	test("the cut never splits a surrogate pair", () => {
		const text = `ab${"😀"}cd`;
		expect(truncateOutput(text, 3)).toEqual({
			output: "ab",
			truncated: true,
			originalLength: 6,
		});
	});

	test("the default limit keeps a head and a tail of a real-size output", () => {
		const text = `${"x".repeat(MAX_TOOL_OUTPUT_CHARS)}THE END`;
		const cut = truncateOutput(text);
		expect(cut.truncated).toBe(true);
		expect(cut.originalLength).toBe(text.length);
		expect(cut.output.endsWith("THE END")).toBe(true);
	});

	test("contentToText joins text blocks and skips the rest", () => {
		expect(contentToText("plain")).toBe("plain");
		expect(
			contentToText([
				{ type: "text", text: "one" },
				{ type: "image" },
				{ type: "text", text: "two" },
			]),
		).toBe("one\n\ntwo");
		expect(contentToText(null)).toBe("");
	});
});
