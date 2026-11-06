import { describe, expect, it } from "vitest";
import type { CheckRun } from "../model.ts";
import { fixErrorsInstruction, type InstructionBase } from "./agent-instructions.ts";

const base: InstructionBase = {
	remote: "origin",
	targetBranch: "main",
	branch: "feature/thing",
	customPrompt: null,
};

const check = (name: string, url: string | null = null): CheckRun => ({
	name,
	state: "failure",
	url,
	startedAt: null,
	completedAt: null,
	required: false,
});

describe("PR-05 fixErrorsInstruction", () => {
	it("names the branch and every failing check with the log tail it has", () => {
		const text = fixErrorsInstruction({
			...base,
			failing: [
				{
					check: check("build", "https://github.com/o/r/actions/runs/1/job/2"),
					logTail: "error: build failed",
					logError: null,
				},
				{ check: check("test"), logTail: null, logError: null },
			],
		});

		expect(text).toContain("Fix the failing checks on the branch `feature/thing`");
		expect(text).toContain("build");
		expect(text).toContain("https://github.com/o/r/actions/runs/1/job/2");
		expect(text).toContain("error: build failed");
		expect(text).toContain("test");
		expect(text).toContain("No log was available for this check.");
	});

	it("tells the agent to find the cause and run the affected checks", () => {
		const text = fixErrorsInstruction({
			...base,
			failing: [{ check: check("lint"), logTail: null, logError: null }],
		});

		expect(text).toContain("Find the cause");
		expect(text).toContain("Run the affected checks");
	});

	it("replaces the default text with the repository's Fix errors prompt", () => {
		const text = fixErrorsInstruction({
			...base,
			customPrompt: "  Use the migration checklist.  ",
			failing: [{ check: check("build"), logTail: "error", logError: null }],
		});

		expect(text).toBe("Use the migration checklist.");
		expect(text).not.toContain("Fix the failing checks");
		expect(text).not.toContain("build");
	});

	it("treats a blank custom prompt as no custom prompt", () => {
		const text = fixErrorsInstruction({
			...base,
			customPrompt: "   ",
			failing: [{ check: check("build"), logTail: null, logError: null }],
		});

		expect(text).toContain("Fix the failing checks");
		expect(text).toContain("build");
	});

	it("says why a check's log could not be read", () => {
		const text = fixErrorsInstruction({
			...base,
			failing: [
				{
					check: check("build", "https://github.com/o/r/actions/runs/1/job/2"),
					logTail: null,
					logError: "No logs were recorded, or they have expired.",
				},
			],
		});

		expect(text).toContain("1. build (https://github.com/o/r/actions/runs/1/job/2)");
		expect(text).toContain("Couldn't read the log: No logs were recorded, or they have expired.");
		expect(text).not.toContain("No log was available for this check.");
	});
});
