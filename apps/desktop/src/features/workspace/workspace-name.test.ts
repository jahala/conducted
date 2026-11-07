/**
 * @feature NAV-10 Workspace name
 * Owns: tests for the one name rule and the branch shown without its prefix.
 * Test first: a user-set name wins over the PR title, the branch and the folder; a branch is shown
 * without the user's prefix, its dashes as spaces and its first letter capitalised, as Conductor does.
 */
import { describe, expect, it } from "vitest";
import { branchWithoutPrefix, workspaceName } from "./workspace-name.ts";

const base = {
	displayName: null,
	prTitle: null,
	branch: "fix-login",
	branchIsPlaceholder: false,
	targetBranch: "origin/main",
	directoryName: "quiet-meadow",
};

describe("NAV-10 workspaceName", () => {
	it("prefers the user's name, then the PR title, the branch and the folder", () => {
		expect(workspaceName({ ...base, displayName: "Mine", prTitle: "A pull request" }, "")).toBe(
			"Mine",
		);
		expect(workspaceName({ ...base, prTitle: "A pull request" }, "")).toBe("A pull request");
		expect(workspaceName(base, "")).toBe("Fix login");
		expect(workspaceName({ ...base, branch: "" }, "")).toBe("Quiet meadow");
	});

	it("treats a name of only spaces as missing", () => {
		expect(workspaceName({ ...base, displayName: "   ", prTitle: " " }, "")).toBe("Fix login");
	});

	it("names a workspace by its branch without the user's prefix, in words", () => {
		expect(workspaceName({ ...base, branch: "sam/fix-login_redirect" }, "sam/")).toBe(
			"Fix login redirect",
		);
		// Another prefix stays, as Conductor strips only the current one.
		expect(workspaceName({ ...base, branch: "kim/fix-login" }, "sam/")).toBe("Kim/fix login");
	});

	it("falls back to the folder while the branch is a placeholder or the target branch", () => {
		expect(workspaceName({ ...base, branchIsPlaceholder: true }, "")).toBe("Quiet meadow");
		expect(workspaceName({ ...base, branch: "main" }, "")).toBe("Quiet meadow");
	});
});

describe("NAV-10 branchWithoutPrefix", () => {
	it("drops the user's prefix and keeps the rest of the branch as it is", () => {
		expect(branchWithoutPrefix("sam/fix-login-redirect", "sam/")).toBe("fix-login-redirect");
		expect(branchWithoutPrefix("sam/fix-login-redirect", "")).toBe("sam/fix-login-redirect");
		expect(branchWithoutPrefix("kim/fix", "sam/")).toBe("kim/fix");
	});
});
