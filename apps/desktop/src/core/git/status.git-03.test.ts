import { appError, err } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { FakeGitRunner, type GitAnswer, gitOutput } from "../../test/fake-git-runner.ts";
import { refreshBranchSync } from "./status.ts";

const input = {
	workspacePath: "/worktree",
	targetRef: "refs/remotes/origin/main",
};

interface Answers {
	/** `git rev-parse HEAD '@{u}'`. */
	refs?: GitAnswer;
	/** `git rev-list --left-right --count <upstream>...<head>`. */
	counts?: GitAnswer;
	/** `git rev-list --count HEAD..<target>`. */
	targetCount?: GitAnswer;
	/** `git rev-parse --symbolic-full-name '@{u}'`. */
	upstreamName?: GitAnswer;
	/** `git reflog show --format=%H <upstream>`. */
	reflog?: GitAnswer;
}

function scripted(answers: Answers = {}): FakeGitRunner {
	return new FakeGitRunner((command) => {
		const args = command.args;
		if (args.includes("--left-right")) return answers.counts ?? gitOutput("0\t0\n");
		if (args.includes("--symbolic-full-name")) {
			return answers.upstreamName ?? gitOutput("refs/remotes/origin/feature\n");
		}
		if (args.includes("reflog")) return answers.reflog ?? gitOutput("");
		if (args.includes("--count")) return answers.targetCount ?? gitOutput("0\n");
		if (args.includes("rev-parse") && args.includes("@{u}")) {
			return answers.refs ?? gitOutput("head\nupstream\n");
		}
		return err(appError("git_unscripted", `unexpected: ${command.args.join(" ")}`));
	});
}

const commandArgs = (runner: FakeGitRunner, token: string): readonly string[] | undefined =>
	runner.commands.find((command) => command.args.includes(token))?.args;

describe("GIT-03 branch sync", () => {
	it("reads HEAD and its upstream, then parses the left-right count into ahead and behind", async () => {
		const runner = scripted({
			refs: gitOutput("head-oid\nupstream-oid\n"),
			counts: gitOutput("2\t5\n"),
			targetCount: gitOutput("4\n"),
			reflog: gitOutput("upstream-oid\n"),
		});

		const result = await refreshBranchSync(runner, input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.sync).toEqual({
			ahead: 5,
			behind: 2,
			rewritten: false,
			hasUpstream: true,
		});
		expect(result.value.behindTarget).toBe(4);
		expect(commandArgs(runner, "@{u}")).toEqual(["rev-parse", "HEAD", "@{u}"]);
		expect(commandArgs(runner, "--left-right")).toEqual([
			"rev-list",
			"--left-right",
			"--count",
			"upstream-oid...head-oid",
		]);
	});

	it("reports no upstream as zero counts and still counts the distance behind the target", async () => {
		const runner = scripted({
			refs: gitOutput("", "fatal: no upstream", 128),
			targetCount: gitOutput("7\n"),
		});

		const result = await refreshBranchSync(runner, input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.sync).toEqual({
			ahead: 0,
			behind: 0,
			rewritten: false,
			hasUpstream: false,
		});
		expect(result.value.behindTarget).toBe(7);
		expect(commandArgs(runner, "--left-right")).toBeUndefined();
		expect(commandArgs(runner, "reflog")).toBeUndefined();
	});

	it("does not call a plain divergence rewritten: the remote never pointed at the local tip", async () => {
		const runner = scripted({
			counts: gitOutput("3\t2\n"),
			reflog: gitOutput("older\n"),
		});

		const result = await refreshBranchSync(runner, input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.sync.rewritten).toBe(false);
	});

	it("calls a diverged branch rewritten when the remote once pointed at the local tip", async () => {
		// A force-push: the local tip was the remote tip (it is in the upstream reflog), and the
		// remote then moved to commits that do not contain it.
		const runner = scripted({
			counts: gitOutput("3\t2\n"),
			upstreamName: gitOutput("refs/remotes/origin/feature\n"),
			reflog: gitOutput("older\nhead\n"),
		});

		const result = await refreshBranchSync(runner, input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.sync.rewritten).toBe(true);
		expect(commandArgs(runner, "reflog")).toEqual([
			"reflog",
			"show",
			"--format=%H",
			"refs/remotes/origin/feature",
		]);
	});

	it("does not read the reflog when the branch is only ahead or only behind", async () => {
		const aheadOnly = scripted({
			counts: gitOutput("0\t5\n"),
			reflog: gitOutput("older\n"),
		});
		const behindOnly = scripted({
			counts: gitOutput("5\t0\n"),
			reflog: gitOutput("older\n"),
		});

		const [ahead, behind] = await Promise.all([
			refreshBranchSync(aheadOnly, input),
			refreshBranchSync(behindOnly, input),
		]);
		expect(ahead.ok).toBe(true);
		expect(behind.ok).toBe(true);
		if (!ahead.ok || !behind.ok) return;
		expect(ahead.value.sync.rewritten).toBe(false);
		expect(behind.value.sync.rewritten).toBe(false);
		expect(commandArgs(aheadOnly, "reflog")).toBeUndefined();
		expect(commandArgs(behindOnly, "reflog")).toBeUndefined();
	});

	it("returns a failed left-right count as an error, not a clean zero", async () => {
		const runner = scripted({ counts: err(appError("git_failed", "rev-list failed")) });

		const result = await refreshBranchSync(runner, input);
		expect(result.ok).toBe(false);
	});

	it("returns a failed reflog read as an error, not a rewritten flag", async () => {
		const runner = scripted({
			counts: gitOutput("3\t2\n"),
			reflog: err(appError("git_failed", "reflog failed")),
		});

		const result = await refreshBranchSync(runner, input);
		expect(result.ok).toBe(false);
	});
});
