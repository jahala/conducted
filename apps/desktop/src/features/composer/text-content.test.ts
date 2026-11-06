/**
 * @feature COMP-01 Composer editor
 * Owns: the tests of turning plain text into editor content.
 * Test first: "a\nb" becomes a text, a hard break and a text, and "<ul>" stays text.
 */
import { describe, expect, it } from "vitest";
import { inlineTextContent, textToDocument } from "./text-content.ts";

describe("COMP-01 plain text as editor content", () => {
	it("turns each line break into a hard break and keeps angle brackets as text", () => {
		expect(inlineTextContent("a <ul>\nb")).toEqual([
			{ type: "text", text: "a <ul>" },
			{ type: "hardBreak" },
			{ type: "text", text: "b" },
		]);
		expect(inlineTextContent("")).toEqual([]);
		expect(inlineTextContent("\n")).toEqual([{ type: "hardBreak" }]);
	});

	it("turns a blank line into a new paragraph", () => {
		expect(textToDocument("one\n\ntwo")).toEqual({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "one" }] },
				{ type: "paragraph", content: [{ type: "text", text: "two" }] },
			],
		});
		expect(textToDocument("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
	});
});
