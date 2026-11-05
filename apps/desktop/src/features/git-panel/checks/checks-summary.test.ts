import { describe, expect, it } from "vitest";
import type { CheckRun, CheckState } from "../../../core/model.ts";
import { sortChecksForDisplay, summarizeChecks } from "./checks-summary.ts";

const check = (name: string, state: CheckState, required = true): CheckRun => ({
	name,
	state,
	url: null,
	startedAt: null,
	completedAt: null,
	required,
});

describe("PR-04 checks summary", () => {
	it("counts failed and pending checks and calls the overall state failing", () => {
		const summary = summarizeChecks(
			[check("failure", "failure"), check("pending", "pending"), check("success", "success")],
			{ treatOptionalAsBlocking: true },
		);
		expect(summary.failed).toBe(1);
		expect(summary.pending).toBe(1);
		expect(summary.total).toBe(3);
		expect(summary.overall).toBe("failing");
	});

	it("reports none when there are no checks", () => {
		const summary = summarizeChecks([], { treatOptionalAsBlocking: true });
		expect(summary).toEqual({ total: 0, failed: 0, pending: 0, passed: 0, overall: "none" });
	});

	it("ignores an optional failure in the overall state when optional checks do not block", () => {
		const summary = summarizeChecks([check("optional", "failure", false)], {
			treatOptionalAsBlocking: false,
		});
		expect(summary.failed).toBe(1);
		expect(summary.overall).toBe("passing");
	});

	it("treats a waiting check as pending", () => {
		expect(
			summarizeChecks([check("waiting", "waiting")], { treatOptionalAsBlocking: true }).overall,
		).toBe("pending");
	});
});

describe("PR-04 checks sort", () => {
	it("puts failed first, then running and pending, then cancelled, skipped and success", () => {
		const sorted = sortChecksForDisplay([
			check("success", "success"),
			check("skipped", "skipped"),
			check("cancelled", "cancelled"),
			check("pending", "pending"),
			check("running", "running"),
			check("failure", "failure"),
		]);
		expect(sorted.map((entry) => entry.name)).toEqual([
			"failure",
			"running",
			"pending",
			"cancelled",
			"skipped",
			"success",
		]);
	});

	it("breaks a tie by name", () => {
		const sorted = sortChecksForDisplay([check("b", "failure"), check("a", "failure")]);
		expect(sorted.map((entry) => entry.name)).toEqual(["a", "b"]);
	});
});
