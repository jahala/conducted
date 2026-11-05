// @vitest-environment node
import { describe, expect, it } from "vitest";
import { aiReviewInstruction } from "./agent-instructions.ts";

describe("REV-05 aiReviewInstruction", () => {
	it("builds the default review text when the repository has no custom prompt", () => {
		const text = aiReviewInstruction({ customPrompt: null, extraInstructions: null });

		expect(text).toContain("git diff");
		expect(text).toContain("Do not edit any files");
	});

	it("replaces the default text with the repository's custom review prompt", () => {
		const text = aiReviewInstruction({
			customPrompt: "  Check every migration for a lock.  ",
			extraInstructions: null,
		});

		expect(text).toBe("Check every migration for a lock.");
		expect(text).not.toContain("Do not edit any files");
	});

	it("adds the extra instructions from the review dialog to the chosen base", () => {
		const text = aiReviewInstruction({
			customPrompt: "Check every migration for a lock.",
			extraInstructions: "Pay attention to the index changes.",
		});

		expect(text).toContain("Check every migration for a lock.");
		expect(text).toContain("Pay attention to the index changes.");
	});

	it("treats a blank custom prompt as no custom prompt", () => {
		const text = aiReviewInstruction({ customPrompt: "   ", extraInstructions: null });

		expect(text).toContain("Do not edit any files");
	});
});
