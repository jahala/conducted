import { describe, expect, it } from "vitest";
import * as c from "./commands.ts";

describe("GIT-01 git command catalogue", () => {
	it("treats exit code 1 of a verify probe as a normal answer", () => {
		expect(c.revParseVerify("refs/heads/x").okExitCodes).toEqual([0, 1]);
		expect(c.showRefVerify("refs/heads/x").okExitCodes).toEqual([0, 1]);
	});

	it("keeps user-controlled names as separate arguments", () => {
		const cmd = c.worktreeAddNewBranch("/w/a b", "me/--force", "abc");
		expect(cmd.args).toEqual(["worktree", "add", "/w/a b", "-b", "me/--force", "abc"]);
	});

	it("puts remote and branch names after `--` so an option-like name stays a name", () => {
		const evil = "--upload-pack=touch /tmp/x";
		const operandsAfterDashes = (cmd: c.GitCommand): string[] => {
			const at = cmd.args.indexOf("--");
			expect(at).toBeGreaterThan(-1);
			expect(cmd.args.slice(0, at)).not.toContain(evil);
			return [...cmd.args.slice(at + 1)];
		};
		expect(operandsAfterDashes(c.fetch(evil))).toEqual([evil]);
		expect(operandsAfterDashes(c.pushHeadTo(evil, "main"))).toEqual([evil, "HEAD:main"]);
		expect(operandsAfterDashes(c.pushHeadSetUpstream(evil, "main"))).toEqual([evil, "HEAD:main"]);
		expect(operandsAfterDashes(c.remoteGetUrl(evil))).toEqual([evil]);
		expect(operandsAfterDashes(c.remoteSetUrl(evil, "u"))).toEqual([evil, "u"]);
		expect(operandsAfterDashes(c.branchCreate(evil, "main"))).toEqual([evil, "main"]);
		expect(operandsAfterDashes(c.branchRename(evil, "n"))).toEqual([evil, "n"]);
		expect(operandsAfterDashes(c.branchDeleteForce(evil))).toEqual([evil]);
	});

	it("fetches without writing FETCH_HEAD and marks itself as network work", () => {
		const cmd = c.fetch("origin", ["main"]);
		expect(cmd.args).toEqual(["fetch", "--no-write-fetch-head", "--prune", "--", "origin", "main"]);
		expect(cmd.network).toBe(true);
	});

	it("uses a literal pathspec for single-file patches", () => {
		const cmd = c.diffFilePatch("base", null, "src/[a].ts", true);
		expect(cmd.args.at(-1)).toBe(":(literal)src/[a].ts");
		expect(cmd.args).toContain("--ignore-all-space");
	});

	it("compares to the working tree when `to` is null", () => {
		expect(c.diffNameStatus("base").args.at(-1)).toBe("base");
		expect(c.diffNameStatus("base", "head").args.slice(-2)).toEqual(["base", "head"]);
	});

	it("orders a first push as push, two config writes, then a fetch", () => {
		const steps = c.firstPushSteps("origin", "me/oslo", "me/oslo");
		expect(steps.map((s) => s.args[0])).toEqual(["push", "config", "config", "fetch"]);
		expect(steps[2]?.args).toEqual(["config", "branch.me/oslo.merge", "refs/heads/me/oslo"]);
	});

	it("lists skip codes of the checkpointer as success", () => {
		expect(c.checkpointerSave("/b/checkpointer.sh", "id").okExitCodes).toEqual([0, 101, 102]);
	});

	it("lists refs by prefix with full names", () => {
		expect(c.forEachRefNames("refs/conducted/checkpoints/session-s1-turn-").args).toEqual([
			"for-each-ref",
			"--format=%(refname)",
			"refs/conducted/checkpoints/session-s1-turn-",
		]);
	});

	it("renames the current branch when the old name is unknown", () => {
		expect(c.branchRename(null, "new").args).toEqual(["branch", "-m", "--", "new"]);
		expect(c.branchRename("old", "new").args).toEqual(["branch", "-m", "--", "old", "new"]);
	});

	it("treats exit 1 of the merge probe as an answer and keeps both branch names separate", () => {
		const cmd = c.mergeTreeWriteTree("main", "me/--oslo");
		expect(cmd.args).toEqual(["merge-tree", "--write-tree", "--no-messages", "main", "me/--oslo"]);
		expect(cmd.okExitCodes).toEqual([0, 1]);
	});

	it("catches a stack branch up with a rebase that never autostashes or rewrites other refs", () => {
		const cmd = c.rebaseOntoUpstream("up", "local");
		expect(cmd.args.slice(0, 2)).toEqual(["rebase", "--interactive"]);
		expect(cmd.args).toContain("--no-autostash");
		expect(cmd.args).toContain("--no-update-refs");
		expect(cmd.args.slice(-3)).toEqual(["--onto", "up", "local"]);
		expect(cmd.retryOnLock).toBe(false);
	});

	it("writes a compare-and-swap as one line per instruction on stdin", () => {
		const cmd = c.updateRefStdin(["verify refs/x old", "update refs/x new old"]);
		expect(cmd.stdin).toBe("verify refs/x old\nupdate refs/x new old\n");
	});

	it("reads the identity git gives commits, for the agent", () => {
		expect(c.configUserName().args).toEqual(["config", "--get", "user.name"]);
		expect(c.configUserEmail().args).toEqual(["config", "--get", "user.email"]);
	});

	it("restores a discarded file to its committed state", () => {
		expect(c.discardFileChanges("src/a b.ts").args).toEqual([
			"restore",
			"--source=HEAD",
			"--worktree",
			"--staged",
			"--",
			"src/a b.ts",
		]);
	});

	it("shows the current branch from its merge base to HEAD", () => {
		expect(c.currentBranchDiffNameStatus("mb").args).toEqual([
			"diff",
			"-M",
			"--no-ext-diff",
			"--no-textconv",
			"--name-status",
			"mb",
			"HEAD",
		]);
		expect(c.currentBranchDiffNumstat("mb").args.at(-1)).toBe("HEAD");
	});

	it("shows all changes from the merge base to the working tree", () => {
		const cmd = c.allChangesDiffNameStatus("mb");
		expect(cmd.args.at(-1)).toBe("mb");
		expect(cmd.args).not.toContain("HEAD");
		expect(c.allChangesDiffNumstat("mb").args.at(-1)).toBe("mb");
	});

	it("reads the committed shared settings file from a ref", () => {
		expect(c.showSettingsFileAt("origin/main").args).toEqual([
			"show",
			"--no-ext-diff",
			"--no-textconv",
			"origin/main:.conducted/settings.toml",
		]);
	});
});
