import { expect, test } from "bun:test";
import { contentToText, truncateOutput } from "./output.ts";

test("output over the limit is cut and flagged, output at the limit is kept", () => {
	expect(truncateOutput("a".repeat(10), 4)).toEqual({ output: "aaaa", truncated: true });
	expect(truncateOutput("abcd", 4)).toEqual({ output: "abcd", truncated: false });
});

test("the cut never splits a surrogate pair", () => {
	const text = `ab${"😀"}cd`;
	expect(truncateOutput(text, 3)).toEqual({ output: "ab", truncated: true });
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
