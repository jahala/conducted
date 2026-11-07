import { describe, expect, it } from "vitest";
import { createPrInstruction, type InstructionBase } from "./agent-instructions.ts";

const base: InstructionBase = {
	remote: "origin",
	targetBranch: "main",
	branch: "feature/thing",
	customPrompt: null,
};

describe("PR-02 createPrInstruction", () => {
	it("names the target branch, gh pr create and the PR template path", () => {
		const text = createPrInstruction({
			...base,
			draft: false,
			prTemplatePath: ".github/pull_request_template.md",
			hasUncommittedChanges: false,
		});

		expect(text).toContain("main");
		expect(text).toContain("gh pr create --base main");
		expect(text).toContain(".github/pull_request_template.md");
		expect(text).toContain("git diff origin/main...");
	});

	it("asks for a draft pull request only when the user chose Create draft PR", () => {
		const draft = createPrInstruction({
			...base,
			draft: true,
			prTemplatePath: null,
			hasUncommittedChanges: false,
		});
		const ready = createPrInstruction({
			...base,
			draft: false,
			prTemplatePath: null,
			hasUncommittedChanges: false,
		});

		expect(draft).toContain("gh pr create --base main --draft");
		expect(draft).toContain("draft pull request");
		expect(ready).not.toContain("--draft");
		expect(ready).not.toContain("draft");
	});

	it("asks for a commit only when there are uncommitted changes", () => {
		const dirty = createPrInstruction({
			...base,
			draft: false,
			prTemplatePath: null,
			hasUncommittedChanges: true,
		});
		const clean = createPrInstruction({
			...base,
			draft: false,
			prTemplatePath: null,
			hasUncommittedChanges: false,
		});

		expect(dirty).toContain("uncommitted changes");
		expect(clean).not.toContain("uncommitted changes");
	});

	it("keeps the built-in steps when the repository adds its own prompt", () => {
		const text = createPrInstruction({
			...base,
			draft: false,
			customPrompt: "Use the release notes as the description.",
			prTemplatePath: null,
			hasUncommittedChanges: false,
		});

		expect(text).toContain("gh pr create --base main");
		expect(text).toContain("Use the release notes as the description.");
	});

	it("never asks to rename the branch and only force pushes with a lease", () => {
		const text = createPrInstruction({
			...base,
			draft: false,
			prTemplatePath: null,
			hasUncommittedChanges: true,
		});

		expect(text).not.toContain("git branch -m");
		expect(text).not.toMatch(/--force(?!-with-lease)/);
		expect(text).toContain("--force-with-lease");
	});

	it("does not leave a template heading when the repository has no template", () => {
		const text = createPrInstruction({
			...base,
			draft: false,
			prTemplatePath: null,
			hasUncommittedChanges: false,
		});

		expect(text).not.toContain("pull request template");
	});

	it("adds the workspace link when the setting is on, and says where it works", () => {
		const link = "conducted://workspace?id=w1";
		const text = createPrInstruction({
			...base,
			draft: false,
			prTemplatePath: null,
			hasUncommittedChanges: false,
			workspaceLink: link,
		});

		expect(text).toContain(link);
		expect(text).toContain("on this Mac");
		expect(text).toContain("does not work for anyone else");
	});

	it("leaves the workspace link out when the setting is off", () => {
		const text = createPrInstruction({
			...base,
			draft: false,
			prTemplatePath: null,
			hasUncommittedChanges: false,
			workspaceLink: null,
		});

		expect(text).not.toContain("conducted://");
		expect(text).not.toContain("on this Mac");
	});
});
