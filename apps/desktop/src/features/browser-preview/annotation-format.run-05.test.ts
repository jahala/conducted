/**
 * @feature RUN-05 Annotation message text
 * Owns: tests for the text one or more page annotations become, and the edge cases the message
 * must survive: several pages, Markdown in a note, an empty element, a missing element and long
 * element text.
 * Test first: one annotation gives text that contains the URL, the selector and the note exactly
 * once.
 */
import { describe, expect, it } from "vitest";
import { formatAnnotations, type PageAnnotation } from "./annotation-format.ts";

const annotation = (partial: Partial<PageAnnotation> = {}): PageAnnotation => ({
	id: partial.id ?? "annotation-1",
	url: partial.url ?? "http://localhost:5173/pricing",
	selector: partial.selector ?? "#buy-button",
	elementText: partial.elementText === undefined ? "Buy now" : partial.elementText,
	note: partial.note ?? "The button is too small.",
	stillMatches: partial.stillMatches ?? true,
});

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

describe("RUN-05 annotation message text", () => {
	it("one annotation gives text that contains the URL, the selector and the note exactly once", () => {
		const item = annotation();
		const text = formatAnnotations([item]);

		expect(text).not.toBeNull();
		const value = text ?? "";
		expect(occurrences(value, item.url)).toBe(1);
		expect(occurrences(value, item.selector)).toBe(1);
		expect(occurrences(value, item.note)).toBe(1);
		expect(value).toContain(item.elementText ?? "");
	});

	it("two annotations produce one message listing both in order", () => {
		const first = annotation({ id: "a", note: "First note", selector: "#first" });
		const second = annotation({ id: "b", note: "Second note", selector: "#second" });
		const text = formatAnnotations([first, second]) ?? "";

		expect(occurrences(text, "Page annotations")).toBe(1);
		expect(text.indexOf("First note")).toBeLessThan(text.indexOf("Second note"));
		expect(text.indexOf("#first")).toBeLessThan(text.indexOf("#second"));
	});

	it("returns null when there is nothing to send", () => {
		expect(formatAnnotations([])).toBeNull();
	});

	it("groups annotations on several pages by URL", () => {
		const pricing = annotation({ id: "a", url: "http://localhost:5173/pricing" });
		const docs = annotation({ id: "b", url: "http://localhost:5173/docs", note: "Docs note" });
		const pricingAgain = annotation({ id: "c", note: "Second pricing note" });
		const text = formatAnnotations([pricing, docs, pricingAgain]) ?? "";

		expect(occurrences(text, "http://localhost:5173/pricing")).toBe(1);
		expect(occurrences(text, "http://localhost:5173/docs")).toBe(1);
		expect(text.indexOf("http://localhost:5173/pricing")).toBeLessThan(
			text.indexOf("http://localhost:5173/docs"),
		);
		expect(text.indexOf("Second pricing note")).toBeLessThan(text.indexOf("Docs note"));
	});

	it("escapes Markdown characters in a note", () => {
		const text = formatAnnotations([annotation({ note: "*Make it* [bigger](#size)" })]) ?? "";

		expect(text).toContain("\\*Make it\\*");
		expect(text).toContain("\\[bigger\\]\\(\\#size\\)");
	});

	it("says when the element has no text", () => {
		const text = formatAnnotations([annotation({ elementText: null })]) ?? "";

		expect(text).toContain("(no text)");
	});

	it("cuts element text to 200 characters", () => {
		const long = "a".repeat(250);
		const text = formatAnnotations([annotation({ elementText: long })]) ?? "";

		expect(text).toContain("a".repeat(200));
		expect(text).not.toContain("a".repeat(201));
	});

	it("marks an annotation whose element no longer matches", () => {
		const text = formatAnnotations([annotation({ stillMatches: false })]) ?? "";

		expect(text).toContain("not found again");
	});
});
