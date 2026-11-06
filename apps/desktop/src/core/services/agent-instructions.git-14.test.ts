import { describe, expect, it } from "vitest";
import { type InstructionBase, mergeIntoTargetInstruction } from "./agent-instructions.ts";

const base: InstructionBase = {
	remote: "origin",
	targetBranch: "main",
	branch: "feature/local",
	customPrompt: null,
};

describe("GIT-14 mergeIntoTargetInstruction", () => {
	it("names the branch and target and asks for a fast-forward, without a push", () => {
		const text = mergeIntoTargetInstruction(base);

		expect(text).toContain("feature/local");
		expect(text).toContain("main");
		expect(text).toContain("fast-forward");
		expect(text).toContain("merge commit");
		expect(text).not.toContain("push");
	});

	it("adds the repository's custom instructions after the built-in text", () => {
		const text = mergeIntoTargetInstruction({
			...base,
			customPrompt: "Ask me before merging.",
		});

		expect(text).toContain("Repository instructions for Merge into target:");
		expect(text).toContain("Ask me before merging.");
	});
});
