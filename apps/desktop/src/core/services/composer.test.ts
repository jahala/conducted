import { describe, expect, it } from "vitest";
import { classifyAttachment, convertsToAttachment } from "./composer.ts";

describe("classifyAttachment", () => {
	it("reads the extension case-insensitively", () => {
		expect(classifyAttachment("shot.PNG")).toBe("image");
		expect(classifyAttachment("notes.md")).toBe("text");
		expect(classifyAttachment("report.pdf")).toBe("file");
	});
	it("treats a name without an extension as a file", () => {
		expect(classifyAttachment("README")).toBe("file");
	});
});

describe("convertsToAttachment", () => {
	it("keeps short text in the editor", () => {
		expect(convertsToAttachment("hello")).toBe(false);
	});
	it("converts text over 5000 characters", () => {
		expect(convertsToAttachment("a".repeat(5_001))).toBe(true);
		expect(convertsToAttachment("a".repeat(5_000))).toBe(false);
	});
	it("converts text over 90 lines", () => {
		expect(convertsToAttachment(Array.from({ length: 91 }, () => "x").join("\n"))).toBe(true);
		expect(convertsToAttachment(Array.from({ length: 90 }, () => "x").join("\n"))).toBe(false);
	});
});
