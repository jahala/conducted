import { describe, expect, it } from "vitest";
import {
	type InstructionBase,
	pullRebaseStrategy,
	resolveConflictsInstruction,
} from "./agent-instructions.ts";

const base: InstructionBase = {
	remote: "origin",
	targetBranch: "main",
	branch: "feature/thing",
	customPrompt: null,
};

describe("GIT-07 resolveConflictsInstruction", () => {
	it("tells the agent to rebase, resolve, continue and push with a lease", () => {
		const text = resolveConflictsInstruction({ ...base, strategy: "rebase" });

		expect(text).toContain("Rebase");
		expect(text).toContain("origin/main");
		expect(text).toContain("resolve");
		expect(text).toContain("git rebase --continue");
		expect(text).toContain("--force-with-lease");
		expect(text).not.toMatch(/--force(?!-with-lease)/);
	});

	it("tells the agent to merge and push without a force when the strategy is merge", () => {
		const text = resolveConflictsInstruction({ ...base, strategy: "merge" });

		expect(text).toContain("Merge");
		expect(text).toContain("origin/main");
		expect(text).toContain("resolve");
		expect(text.toLowerCase()).not.toContain("force");
	});

	it("omits the push when the repository has no remote", () => {
		const text = resolveConflictsInstruction({
			...base,
			remote: "",
			strategy: "merge",
		});

		expect(text).toContain("main");
		expect(text.toLowerCase()).not.toContain("push");
	});

	it("replaces the default text with the repository's Resolve conflicts prompt", () => {
		const text = resolveConflictsInstruction({
			...base,
			customPrompt: "Keep both sides of every conflict.",
			strategy: "rebase",
		});

		expect(text).toBe("Keep both sides of every conflict.");
		expect(text).not.toContain("git rebase --continue");
	});

	it("treats pull.rebase true values as rebase and everything else as merge", () => {
		for (const value of ["true", "yes", "on", "1", "merges", "interactive", "preserve"]) {
			expect(pullRebaseStrategy(value)).toBe("rebase");
		}
		for (const value of ["", "false", "no", "off", "0", "unset"]) {
			expect(pullRebaseStrategy(value)).toBe("merge");
		}
	});
});
