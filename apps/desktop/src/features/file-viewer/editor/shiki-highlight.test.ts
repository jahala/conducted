/**
 * @feature REV-08 Editor syntax highlighting
 * Tests the pure parts: a path's Shiki language, a token's inline style, and the token ranges on a
 * document.
 */
import { Text } from "@codemirror/state";
import type { ThemedToken } from "shiki";
import { describe, expect, it } from "vitest";
import { shikiLanguageFor, styleFor, tokenDecorations } from "./shiki-highlight.ts";

const token = (over: Partial<ThemedToken>): ThemedToken =>
	({ content: "", offset: 0, ...over }) as ThemedToken;

describe("REV-08 Shiki highlighting", () => {
	it("maps a file's language, and gives no language to an unknown type", () => {
		expect(shikiLanguageFor("src/main.rs")).toBe("rust");
		expect(shikiLanguageFor("src/a.ts")).toBe("typescript");
		expect(shikiLanguageFor("src/a.tsx")).toBe("tsx");
		expect(shikiLanguageFor("data.bin")).toBeNull();
		expect(shikiLanguageFor("README.md")).toBe("markdown");
	});

	it("turns a token colour and font style into an inline style", () => {
		expect(styleFor(token({ content: "fn", color: "#ff0000" }))).toBe("color:#ff0000");
		expect(styleFor(token({ content: "// note", color: "#888888", fontStyle: 1 }))).toBe(
			"color:#888888;font-style:italic",
		);
		expect(styleFor(token({ content: "bold", fontStyle: 2 }))).toBe("font-weight:700");
		expect(styleFor(token({ content: "plain" }))).toBeNull();
	});

	it("places token ranges on the document's own lines", () => {
		const doc = Text.of(["fn main() {", "}"]);
		const decorations = tokenDecorations(doc, [
			[
				token({ content: "fn", color: "#ff0000" }),
				token({ content: " main", color: "#00ff00" }),
				token({ content: "() {", color: "#0000ff" }),
			],
			[token({ content: "}", color: "#0000ff" })],
		]);
		const ranges: { from: number; to: number; style: string }[] = [];
		decorations.between(0, doc.length, (from, to, value) => {
			ranges.push({ from, to, style: String(value.spec.attributes?.style) });
		});
		expect(ranges).toEqual([
			{ from: 0, to: 2, style: "color:#ff0000" },
			{ from: 2, to: 7, style: "color:#00ff00" },
			{ from: 7, to: 11, style: "color:#0000ff" },
			{ from: 12, to: 13, style: "color:#0000ff" },
		]);
	});

	it("never draws past the end of a document that Shiki saw differently", () => {
		const doc = Text.of(["ab"]);
		const decorations = tokenDecorations(doc, [[token({ content: "abcdef", color: "#fff" })]]);
		expect(decorations.size).toBe(0);
	});
});
