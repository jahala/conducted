import { describe, expect, it } from "vitest";
import { reconcileInstruction } from "./agent-instructions.ts";

const base = {
	remote: "origin",
	targetBranch: "main",
	branch: "feat",
	customPrompt: null,
};

describe("GIT-06 reconcileInstruction", () => {
	it("commits a dirty worktree, then rebases and force-pushes with a lease", () => {
		const text = reconcileInstruction({ ...base, strategy: "rebase", dirty: true });
		expect(text).toContain("commit");
		expect(text).toContain("Rebase this branch onto `origin/main`.");
		expect(text).toContain("git push --force-with-lease");
		expect(text).not.toContain("git push --force ");
	});

	it("merges the target branch and pushes", () => {
		const text = reconcileInstruction({ ...base, strategy: "merge", dirty: false });
		expect(text).toContain("Merge `origin/main` into this branch.");
		expect(text).toContain("git push");
		expect(text).not.toContain("force");
	});

	it("omits the push when the forge has no remote", () => {
		const text = reconcileInstruction({
			...base,
			remote: "",
			strategy: "rebase",
			dirty: false,
		});
		expect(text).toContain("Rebase this branch onto `main`.");
		expect(text).not.toContain("git push");
	});

	it("adds the repository's custom instructions without replacing the built-in text", () => {
		const text = reconcileInstruction({
			...base,
			strategy: "merge",
			dirty: true,
			customPrompt: "Ask me before rebasing.",
		});
		expect(text).toContain("Review the uncommitted changes");
		expect(text).toContain("Repository instructions for Reconcile:");
		expect(text).toContain("Ask me before rebasing.");
	});
});
