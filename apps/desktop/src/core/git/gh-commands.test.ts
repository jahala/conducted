import { describe, expect, it } from "vitest";
import * as gh from "./gh-commands.ts";

describe("PR-01 gh command catalogue", () => {
	it("runs every GitHub call through the user's gh", () => {
		for (const command of [
			gh.authStatus(),
			gh.apiUserLogin(),
			gh.configGetGitProtocol(),
			gh.prMerge(1, "squash", "abc", false),
			gh.prApprove(1, "abc"),
			gh.prEdit(1, { title: "T" }),
		]) {
			expect(command.program).toBe("gh");
		}
	});

	it("reads the git protocol gh is set to use", () => {
		const command = gh.configGetGitProtocol();
		expect(command.args).toEqual(["config", "get", "git_protocol"]);
		expect(command.okExitCodes).toEqual([0, 1]);
	});

	it("treats a signed-out auth status as an answer", () => {
		expect(gh.authStatus().okExitCodes).toEqual([0, 1]);
	});

	it("asks for the login with gh api user", () => {
		expect(gh.apiUserLogin().args).toEqual(["api", "user", "--jq", ".login"]);
	});

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

	it("sends a review thread id as a plain string, never as a typed field or a file read", () => {
		const args = gh.resolveReviewThread("@/etc/hosts").args;
		const at = args.indexOf("threadId=@/etc/hosts");
		expect(at).toBeGreaterThan(0);
		expect(args[at - 1]).toBe("-f");
	});

	it("only sends the title when it changes", () => {
		expect(gh.prEdit(3, { title: "T" }).args).toEqual(["pr", "edit", "3", "--title", "T"]);
	});
});
