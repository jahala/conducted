/**
 * @feature REV-08 Preview kind
 * Tests the pure decision between the preview components.
 */
import { describe, expect, it } from "vitest";
import { classifyPreview } from "./preview-kind.ts";

describe("REV-08 classifyPreview", () => {
	it("treats an upper-case image extension as an image", () => {
		expect(classifyPreview("a/B.PNG", true)).toBe("image");
	});

	it("treats a Markdown file as Markdown", () => {
		expect(classifyPreview("notes.md", false)).toBe("markdown");
		expect(classifyPreview("notes.markdown", false)).toBe("markdown");
	});

	it("treats SVG as its own preview even though it is text", () => {
		expect(classifyPreview("art/logo.svg", false)).toBe("svg");
	});

	it("treats CSV and TSV files as tables", () => {
		expect(classifyPreview("data.csv", false)).toBe("csv");
		expect(classifyPreview("data.TSV", false)).toBe("csv");
	});

	it("treats PDF and video files as their previews", () => {
		expect(classifyPreview("manual.pdf", true)).toBe("pdf");
		expect(classifyPreview("clip.mov", true)).toBe("video");
		expect(classifyPreview("clip.MP4", true)).toBe("video");
	});

	it("falls back to text for an unknown or missing extension", () => {
		expect(classifyPreview("notes", false)).toBe("text");
		expect(classifyPreview(".env", false)).toBe("text");
		expect(classifyPreview("src/main.ts", false)).toBe("text");
	});

	it("reports an unknown binary file as binary", () => {
		expect(classifyPreview("archive.blob", true)).toBe("binary");
		expect(classifyPreview("image.bin", false)).toBe("binary");
	});
});
