/**
 * @feature NAV-10 Workspace name
 * Owns: tests for the one name rule.
 * Test first: a user-set name wins over the PR title, the branch and the folder; a blank branch
 * falls back to the folder name.
 */
import { describe, expect, it } from "vitest";
import { workspaceName } from "./workspace-name.ts";

const base = {
	displayName: null,
	prTitle: null,
	branch: "fix-login",
	directoryName: "quiet-meadow",
};

describe("NAV-10 workspaceName", () => {
	it("prefers the user's name, then the PR title, the branch and the folder", () => {
		expect(workspaceName({ ...base, displayName: "Mine", prTitle: "A pull request" })).toBe("Mine");
		expect(workspaceName({ ...base, prTitle: "A pull request" })).toBe("A pull request");
		expect(workspaceName(base)).toBe("fix-login");
		expect(workspaceName({ ...base, branch: "" })).toBe("quiet-meadow");
	});

	it("treats a name of only spaces as missing", () => {
		expect(workspaceName({ ...base, displayName: "   ", prTitle: " " })).toBe("fix-login");
	});
});
