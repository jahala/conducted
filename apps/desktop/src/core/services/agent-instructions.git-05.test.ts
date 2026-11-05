import { describe, expect, it } from "vitest";
import { commitAndPushInstruction, type InstructionBase } from "./agent-instructions.ts";

const base: InstructionBase = {
	remote: "origin",
	targetBranch: "main",
	branch: "feature/thing",
	customPrompt: null,
};

describe("GIT-05 commitAndPushInstruction", () => {
	it("asks the agent to commit every change and push the branch to the remote", () => {
		const text = commitAndPushInstruction(base);

		expect(text).toBe(
			"Commit all the changes in this workspace with a clear message, then push the branch " +
				"`feature/thing` to `origin`. Check that the push succeeded.",
		);
		expect(text.toLowerCase()).toContain("commit");
		expect(text.toLowerCase()).toContain("push");
		expect(text).toContain("feature/thing");
		expect(text).toContain("origin");
	});

	it("keeps the built-in instruction when the repository adds its own prompt", () => {
		const text = commitAndPushInstruction({
			...base,
			customPrompt: "Use Conventional Commits.",
		});

		expect(text).toContain("feature/thing");
		expect(text).toContain("Use Conventional Commits.");
	});

	it("never asks for a force push", () => {
		expect(commitAndPushInstruction(base).toLowerCase()).not.toContain("force");
	});
});
