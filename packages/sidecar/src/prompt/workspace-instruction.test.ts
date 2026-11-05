import { describe, expect, test } from "bun:test";
import type { WorkspaceContext } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import { buildWorkspaceInstruction, splitTargetBranch } from "./workspace-instruction.ts";

const base: WorkspaceContext = {
	workspaceId: "w1" as WorkspaceId,
	workspaceName: "lisbon",
	workspacePath: "/work/my tree",
	repoRootPath: "/repos/app",
	targetBranch: "origin/main",
	placeholderBranch: false,
	port: 5100,
};

describe("SIDE-09 first-message workspace instruction", () => {
	test("the block names the folder, the main clone and the target branch", () => {
		const text = buildWorkspaceInstruction(base);
		expect(text).toContain("`/work/my tree`");
		expect(text).toContain("`/repos/app`");
		expect(text).toContain("git diff origin/main...");
		expect(text).toContain("gh pr create --base main");
	});

	test("the block names the .context folder, the last message and new workspaces", () => {
		const text = buildWorkspaceInstruction(base);
		expect(text).toContain("`.context`");
		expect(text).toContain("last message");
		expect(text).toContain("new workspace");
		expect(text).toContain("check out that pull request's branch");
	});

	test("only a placeholder branch gets the temporary-name paragraph", () => {
		expect(buildWorkspaceInstruction({ ...base, placeholderBranch: true })).toContain(
			"temporary name",
		);
		expect(buildWorkspaceInstruction(base)).not.toContain("temporary name");
	});

	test("a target branch without a remote uses origin, and slashes in the branch survive", () => {
		expect(splitTargetBranch("main")).toEqual({ remote: "origin", branch: "main" });
		expect(splitTargetBranch("origin/release/1.2")).toEqual({
			remote: "origin",
			branch: "release/1.2",
		});
	});
});
