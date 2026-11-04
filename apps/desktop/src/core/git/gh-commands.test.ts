import { describe, expect, it } from "vitest";
import * as gh from "./gh-commands.ts";

describe("gh command catalogue", () => {
	it("pins a merge to the local head commit", () => {
		const cmd = gh.prMerge(12, "squash", "abc123", false);
		expect(cmd.program).toBe("gh");
		expect(cmd.args).toEqual(["pr", "merge", "12", "--squash", "--match-head-commit", "abc123"]);
	});

	it("adds --auto only for auto-merge", () => {
		expect(gh.prMerge(1, "rebase", "x", true).args).toContain("--auto");
		expect(gh.prMerge(1, "rebase", "x", false).args).not.toContain("--auto");
	});

	it("pins an approval to the head commit", () => {
		expect(gh.prApprove(7, "deadbeef").args).toContain("commit_id=deadbeef");
	});

	it("passes branch names as variables, not inside the query text", () => {
		const cmd = gh.prBatchQuery([
			{ headBranch: 'evil"}) { x', prNumber: null },
			{ headBranch: "ok", prNumber: 4 },
		]);
		const query = cmd.args.find((a) => a.startsWith("query="));
		expect(query).toBeDefined();
		expect(query).not.toContain("evil");
		expect(cmd.args).toContain('headRefName0=evil"}) { x');
		expect(cmd.args).toContain("prNumber1=4");
		expect(cmd.args).toContain("hasPrNumber0=false");
		expect(query).toContain("pr1ByNumber");
	});

	it("only sends the title when it changes", () => {
		expect(gh.prEdit(3, { title: "T" }).args).toEqual(["pr", "edit", "3", "--title", "T"]);
	});
});
