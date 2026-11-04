import { describe, expect, it } from "vitest";
import { classifyUnarchive } from "./workspace.ts";

describe("classifyUnarchive", () => {
	const base = {
		branchExists: true,
		checkedOutElsewhere: false,
		branchTip: "abc",
		archiveCommit: "abc",
	};
	it("is happy when the branch is where it was left", () => {
		expect(classifyUnarchive(base)).toBe("happy");
	});
	it("reports a deleted branch first", () => {
		expect(classifyUnarchive({ ...base, branchExists: false, checkedOutElsewhere: true })).toBe(
			"branchDeleted",
		);
	});
	it("reports a branch checked out elsewhere", () => {
		expect(classifyUnarchive({ ...base, checkedOutElsewhere: true })).toBe("branchTaken");
	});
	it("reports a branch that moved", () => {
		expect(classifyUnarchive({ ...base, branchTip: "def" })).toBe("branchDiverged");
	});
});
