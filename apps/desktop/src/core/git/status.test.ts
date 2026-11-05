import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "./commands.ts";
import type { GitRunner, GitRunOptions } from "./runner.ts";
import {
	diffTargetOf,
	mergeChanges,
	operationFromMarkers,
	parseCommitLog,
	parseConflictedPaths,
	parseLeftRightCount,
	parseNameStatus,
	parseNumstat,
	parseWorktreeList,
	refreshWorkspaceChanges,
	remoteTargetRef,
	UNTRACKED_COUNT_BATCH_BYTES,
	UNTRACKED_FILE_CAP,
	UNTRACKED_LARGE_FILE_LINES,
	unquotePath,
	untrackedCountBatches,
} from "./status.ts";

describe("GIT-02 unquotePath", () => {
	it("leaves plain paths alone", () => {
		expect(unquotePath("src/a.ts")).toBe("src/a.ts");
	});
	it("decodes octal escapes as UTF-8 bytes", () => {
		expect(unquotePath('"caf\\303\\251.txt"')).toBe("café.txt");
	});
	it("decodes escaped quotes, tabs and backslashes", () => {
		expect(unquotePath('"a\\"b\\tc\\\\d"')).toBe('a"b\tc\\d');
	});
});

describe("GIT-02 parseNameStatus", () => {
	it("maps letters to statuses and reads renames", () => {
		const text = "A\tnew.ts\nM\told.ts\nD\tgone.ts\nR087\tfrom.ts\tto.ts\nT\ttype.ts\n";
		expect(parseNameStatus(text)).toEqual([
			{ path: "new.ts", status: "added" },
			{ path: "old.ts", status: "modified" },
			{ path: "gone.ts", status: "deleted" },
			{ path: "to.ts", oldPath: "from.ts", status: "renamed" },
		]);
	});
});

describe("GIT-02 parseNumstat", () => {
	it("reads counts and binary markers", () => {
		expect(parseNumstat("3\t1\ta.ts\n-\t-\timg.png\n")).toEqual([
			{ path: "a.ts", linesAdded: 3, linesRemoved: 1, binary: false },
			{ path: "img.png", linesAdded: 0, linesRemoved: 0, binary: true },
		]);
	});
	it("reads a brace rename as a rename to the new path", () => {
		const [entry] = parseNumstat("2\t2\tsrc/{a => b}/x.ts\n");
		expect(entry?.path).toBe("src/b/x.ts");
		expect(entry?.oldPath).toBe("src/a/x.ts");
	});
	it("reads a rename into or out of the top folder without double slashes", () => {
		const [entry] = parseNumstat("0\t0\t{ => lib}/x.ts\n");
		expect(entry?.path).toBe("lib/x.ts");
		expect(entry?.oldPath).toBe("x.ts");
	});
	it("reads a plain arrow rename and a /dev/null source", () => {
		expect(parseNumstat("1\t1\ta.ts => b.ts\n")[0]?.path).toBe("b.ts");
		const added = parseNumstat("4\t0\t/dev/null => c.ts\n")[0];
		expect(added?.path).toBe("c.ts");
		expect(added?.oldPath).toBeUndefined();
	});
	it("skips lines it cannot read", () => {
		expect(parseNumstat("garbage\n\n")).toEqual([]);
	});
});

describe("GIT-02 mergeChanges", () => {
	it("joins the two listings on the new path", () => {
		const changes = mergeChanges(
			parseNameStatus("R100\ta.ts\tb.ts\nM\tc.ts\n"),
			parseNumstat("0\t0\ta.ts => b.ts\n5\t2\tc.ts\n"),
		);
		expect(changes).toEqual([
			{
				path: "b.ts",
				oldPath: "a.ts",
				status: "renamed",
				linesAdded: 0,
				linesRemoved: 0,
				binary: false,
			},
			{ path: "c.ts", status: "modified", linesAdded: 5, linesRemoved: 2, binary: false },
		]);
	});
});

describe("GIT-02 parseConflictedPaths", () => {
	it("keeps only conflict codes", () => {
		const text = "UU a.ts\n M b.ts\nAA c.ts\nDD d.ts\nM  e.ts\n";
		expect(parseConflictedPaths(text)).toEqual(["a.ts", "c.ts", "d.ts"]);
	});
});

describe("GIT-02 operationFromMarkers", () => {
	it("prefers rebase, then merge, cherry-pick and revert", () => {
		expect(operationFromMarkers(new Set(["rebase-merge", "MERGE_HEAD"]))).toBe("rebase");
		expect(operationFromMarkers(new Set(["MERGE_HEAD"]))).toBe("merge");
		expect(operationFromMarkers(new Set(["CHERRY_PICK_HEAD"]))).toBe("cherry_pick");
		expect(operationFromMarkers(new Set(["REVERT_HEAD"]))).toBe("revert");
		expect(operationFromMarkers(new Set())).toBe("none");
	});
});

describe("GIT-02 parseLeftRightCount", () => {
	it("reads two counts", () => {
		expect(parseLeftRightCount("2\t5\n")).toEqual({ ok: true, value: { left: 2, right: 5 } });
	});
	it("returns an error value for other text", () => {
		const result = parseLeftRightCount("fatal: bad revision");
		expect(result.ok).toBe(false);
	});
});

describe("GIT-02 parseCommitLog", () => {
	it("keeps a subject and an author name that contain a pipe", () => {
		const [commit] = parseCommitLog("abc\x1ffix a|b bug\x1fAnn | Co\x1fann@x.io\x1f1700000000\n");
		expect(commit).toEqual({
			hash: "abc",
			subject: "fix a|b bug",
			authorName: "Ann | Co",
			authorEmail: "ann@x.io",
			authoredAt: 1700000000,
		});
	});
});

describe("GIT-02 parseWorktreeList", () => {
	it("reads branches and detached heads", () => {
		const text =
			"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/a\nHEAD def\ndetached\n";
		expect(parseWorktreeList(text)).toEqual([
			{ path: "/repo", branch: "main" },
			{ path: "/wt/a", branch: null },
		]);
	});
});

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

function fakeRunner(
	handler: (command: GitCommand, options: GitRunOptions) => Result<ShellOutput>,
): GitRunner {
	const run = async (command: GitCommand, options: GitRunOptions) => handler(command, options);
	const runChecked = async (command: GitCommand, options: GitRunOptions) => {
		const result = await run(command, options);
		if (!result.ok) return result;
		const codes = command.okExitCodes ?? [0];
		return codes.includes(result.value.exitCode)
			? result
			: err(appError("git_failed", result.value.stderr.trim() || "git failed"));
	};
	const stdout = async (command: GitCommand, options: GitRunOptions) => {
		const result = await runChecked(command, options);
		return result.ok ? ok(result.value.stdout.trim()) : result;
	};
	return {
		run,
		runChecked,
		stdout,
		start: async () => {
			throw new Error("start is not used by the changes pipeline");
		},
		withWorktreeLock: (_worktreePath, work) => work(),
		withWorktreeAndRepoLocks: (_worktreePath, _repoRootPath, work) => work(),
	};
}

interface Fixture {
	branch?: string;
	mergeBase?: string | null;
	nameStatus?: string;
	numstat?: string;
	porcelain?: string;
	untracked?: string[];
	/** Untracked paths that git reports as binary (`-` counts). */
	binaryUntracked?: string[];
	fileSizes?: Record<string, number>;
	markers?: string[];
	upstream?: { head: string; upstream: string } | null;
	aheadBehind?: string;
	targetCount?: string;
	log?: string;
	/** Commands that fail before they run, to prove a poll reports the failure. */
	fail?: (command: GitCommand) => boolean;
}

function changesRunner(fixture: Fixture = {}): {
	runner: GitRunner;
	calls: GitCommand[];
	options: GitRunOptions[];
} {
	const calls: GitCommand[] = [];
	const optionsSeen: GitRunOptions[] = [];
	const runner = fakeRunner((command, options) => {
		calls.push(command);
		optionsSeen.push(options);
		if (fixture.fail?.(command) === true) {
			return err(appError("git_failed", `failed: git ${command.args.join(" ")}`));
		}
		if (command.program === "stat") {
			const path = command.args.at(-1) ?? "";
			if (path.startsWith("/git/")) {
				const marker = path.slice("/git/".length);
				return ok(output("", "", fixture.markers?.includes(marker) ? 0 : 1));
			}
			return ok(output(`${fixture.fileSizes?.[path] ?? 10}\n`));
		}
		const [first, second] = command.args;
		if (first === "branch" && second === "--show-current") {
			return ok(output(`${fixture.branch ?? "feat"}\n`));
		}
		if (first === "rev-parse" && second === "--git-path") {
			return ok(output(`/git/${command.args.at(-1)}\n`));
		}
		if (first === "merge-base") {
			return fixture.mergeBase === null
				? err(appError("git_failed", "fatal: no merge base"))
				: ok(output(`${fixture.mergeBase ?? "mb"}\n`));
		}
		if (first === "diff" && command.args.includes("--name-status")) {
			return ok(output(fixture.nameStatus ?? ""));
		}
		if (first === "diff" && command.args.includes("--no-index")) {
			const path = command.args.at(-1) ?? "";
			return ok(
				output(fixture.binaryUntracked?.includes(path) ? `-\t-\t${path}\n` : `3\t0\t${path}\n`),
			);
		}
		if (first === "diff" && command.args.includes("--numstat")) {
			return ok(output(fixture.numstat ?? ""));
		}
		if (first === "status" && second === "--porcelain") {
			return ok(output(fixture.porcelain ?? ""));
		}
		if (first === "ls-files") {
			const paths = fixture.untracked ?? [];
			return ok(output(paths.join("\0")));
		}
		if (first === "rev-parse" && second === "HEAD") {
			if (fixture.upstream === null) return ok(output("", "fatal: no upstream", 128));
			const head = fixture.upstream?.head ?? "head";
			const upstream = fixture.upstream?.upstream ?? "upstream";
			return ok(output(`${head}\n${upstream}\n`));
		}
		if (first === "rev-list" && command.args.includes("--left-right")) {
			return ok(output(`${fixture.aheadBehind ?? "0\t0"}\n`));
		}
		if (first === "rev-list" && second === "--count") {
			return ok(output(`${fixture.targetCount ?? "0"}\n`));
		}
		if (first === "log") {
			return ok(output(fixture.log ?? ""));
		}
		return err(appError("git_failed", `unexpected command: ${command.args.join(" ")}`));
	});
	return { runner, calls, options: optionsSeen };
}

const workspaceId = "workspace-1" as WorkspaceId;
const input = (depth: "metadata" | "uncommitted" | "full", extra = {}) => ({
	workspaceId,
	workspacePath: "/worktree",
	targetRef: "refs/remotes/origin/main",
	remote: "origin",
	depth,
	...extra,
});

describe("GIT-02 diff target precedence", () => {
	it("takes a Graphite parent first, then the pull request base, then the intended target", () => {
		const intended = {
			graphiteParentBranch: null,
			pullRequestBaseBranch: null,
			intendedTargetBranch: "origin/main",
			remote: "origin",
		};
		expect(diffTargetOf(intended)).toEqual({
			branch: "origin/main",
			ref: "refs/remotes/origin/main",
			source: "intended",
			isLocalStackParent: false,
		});
		expect(diffTargetOf({ ...intended, pullRequestBaseBranch: "develop" })).toMatchObject({
			branch: "develop",
			ref: "refs/remotes/origin/develop",
			source: "pull_request",
		});
		expect(
			diffTargetOf({
				...intended,
				pullRequestBaseBranch: "develop",
				graphiteParentBranch: "feature/parent",
			}),
		).toEqual({
			branch: "feature/parent",
			ref: "feature/parent",
			source: "graphite_parent",
			isLocalStackParent: true,
		});
	});

	it("builds a remote ref without doubling the remote name", () => {
		expect(remoteTargetRef("origin/main", "origin")).toBe("refs/remotes/origin/main");
		expect(remoteTargetRef("main", "origin")).toBe("refs/remotes/origin/main");
		expect(remoteTargetRef("refs/heads/local", "origin")).toBe("refs/heads/local");
	});
});

describe("GIT-02 untracked counting batches", () => {
	it("keeps every batch under the byte cap and keeps every path", () => {
		const paths = Array.from({ length: 10_000 }, (_, index) => `src/folder-${index}/file.ts`);
		const batches = untrackedCountBatches(paths);
		expect(batches.length).toBeGreaterThan(1);
		expect(batches.flat()).toEqual(paths);
		const encoder = new TextEncoder();
		for (const batch of batches) {
			const bytes = batch.reduce((sum, path) => sum + encoder.encode(path).length + 1, 0);
			expect(bytes).toBeLessThanOrEqual(UNTRACKED_COUNT_BATCH_BYTES);
		}
	});
});

describe("GIT-02 full changes refresh", () => {
	it("assembles files, conflicts, untracked counts, sync, distance behind and commits", async () => {
		const { runner } = changesRunner({
			nameStatus: "M\ta.ts\n",
			numstat: "2\t1\ta.ts\n",
			porcelain: "UU conflict.ts\n",
			untracked: ["new.ts"],
			upstream: { head: "head-oid", upstream: "upstream-oid" },
			aheadBehind: "1\t3",
			targetCount: "2",
			log: "abc\x1ffix a|b bug\x1fAnn\x1fann@x.io\x1f1700000000\n",
		});

		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.branch).toBe("feat");
		expect(result.value.mergeBase).toBe("mb");
		expect(result.value.mergeBaseError).toBeNull();
		expect(result.value.files).toEqual([
			{ path: "a.ts", status: "modified", linesAdded: 2, linesRemoved: 1, binary: false },
			{ path: "new.ts", status: "added", linesAdded: 3, linesRemoved: 0, binary: false },
		]);
		expect(result.value.conflictedPaths).toEqual(["conflict.ts"]);
		expect(result.value.untrackedTruncated).toBe(false);
		expect(result.value.sync).toEqual({
			ahead: 3,
			behind: 1,
			rewritten: false,
			hasUpstream: true,
		});
		expect(result.value.behindTarget).toBe(2);
		expect(result.value.commits[0]?.subject).toBe("fix a|b bug");
	});

	it("reports a missing merge base and leaves the file list empty", async () => {
		const { runner, calls } = changesRunner({ mergeBase: null });
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.mergeBase).toBeNull();
		expect(result.value.mergeBaseError).toBe("fatal: no merge base");
		expect(result.value.files).toEqual([]);
		expect(calls.some((command) => command.args.includes("--name-status"))).toBe(false);
	});

	it("uses HEAD for an uncommitted-only refresh", async () => {
		const { runner, calls } = changesRunner({ nameStatus: "M\ta.ts\n", numstat: "1\t0\ta.ts\n" });
		const result = await refreshWorkspaceChanges(runner, input("uncommitted"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files[0]?.path).toBe("a.ts");
		expect(
			calls.some(
				(command) => command.args.includes("--name-status") && command.args.includes("HEAD"),
			),
		).toBe(true);
		expect(calls.some((command) => command.args[0] === "merge-base")).toBe(false);
	});

	it("reads only the local branch at metadata depth", async () => {
		const { runner, calls } = changesRunner({ markers: ["MERGE_HEAD"] });
		const result = await refreshWorkspaceChanges(runner, input("metadata"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.branch).toBe("feat");
		expect(result.value.operation).toBe("none");
		expect(result.value.files).toEqual([]);
		expect(calls.every((command) => command.args[0] === "branch")).toBe(true);
	});

	it("caps the untracked list and flags it", async () => {
		const untracked = Array.from({ length: UNTRACKED_FILE_CAP + 1 }, (_, index) => `f${index}.ts`);
		const { runner } = changesRunner({ untracked });
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files).toHaveLength(UNTRACKED_FILE_CAP);
		expect(result.value.untrackedTruncated).toBe(true);
	});

	it("does not read an untracked file over 300 KB", async () => {
		const { runner, calls } = changesRunner({
			untracked: ["huge.log"],
			fileSizes: { "huge.log": 400 * 1024 },
		});
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files[0]?.linesAdded).toBe(UNTRACKED_LARGE_FILE_LINES);
		expect(
			calls.some(
				(command) => command.args.includes("--no-index") && command.args.at(-1) === "huge.log",
			),
		).toBe(false);
	});

	it("keeps a non-ASCII untracked path unquoted and counts its lines", async () => {
		const { runner, calls } = changesRunner({ untracked: ["café.ts"] });
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files).toEqual([
			{ path: "café.ts", status: "added", linesAdded: 3, linesRemoved: 0, binary: false },
		]);
		const listed = calls.find((command) => command.args[0] === "ls-files");
		expect(listed?.args).toContain("-z");
		expect(
			calls.some((command) => command.program === "stat" && command.args.at(-1) === "café.ts"),
		).toBe(true);
	});

	it("marks an untracked binary file as binary with no line count", async () => {
		const { runner } = changesRunner({ untracked: ["logo.png"], binaryUntracked: ["logo.png"] });
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files).toEqual([
			{ path: "logo.png", status: "added", linesAdded: 0, linesRemoved: 0, binary: true },
		]);
	});

	it("keeps a NUL-separated path that contains a newline in one piece", async () => {
		const { runner } = changesRunner({ untracked: ["line\nbreak.ts"] });
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.files[0]?.path).toBe("line\nbreak.ts");
	});

	it("treats exit 128 from the upstream probe as no upstream", async () => {
		const { runner } = changesRunner({ upstream: null });
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.sync).toEqual({
			ahead: 0,
			behind: 0,
			rewritten: false,
			hasUpstream: false,
		});
	});

	it("picks the diff target from the supplied stack information", async () => {
		const { runner, calls } = changesRunner({ nameStatus: "M\ta.ts\n", numstat: "1\t0\ta.ts\n" });
		await refreshWorkspaceChanges(
			runner,
			input("full", {
				diffTarget: {
					graphiteParentBranch: "feature/parent",
					pullRequestBaseBranch: null,
					intendedTargetBranch: "origin/main",
					remote: "origin",
				},
			}),
		);
		const merge = calls.find((command) => command.args[0] === "merge-base");
		expect(merge?.args).toEqual(["merge-base", "feature/parent", "feat"]);
	});
});

describe("GIT-02 failed polls are reported, not shown as a clean branch", () => {
	it("returns the error when a git directory marker cannot be checked", async () => {
		const { runner } = changesRunner({
			fail: (command) =>
				command.program === "stat" && command.args.at(-1)?.startsWith("/git/") === true,
		});
		const result = await refreshWorkspaceChanges(runner, input("uncommitted"));
		expect(result.ok).toBe(false);
	});

	it("returns the error when the git path of a marker cannot be read", async () => {
		const { runner } = changesRunner({
			fail: (command) => command.args[0] === "rev-parse" && command.args[1] === "--git-path",
		});
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(false);
	});

	it("reads a merge in progress from the marker files", async () => {
		const { runner } = changesRunner({ markers: ["MERGE_HEAD"] });
		const result = await refreshWorkspaceChanges(runner, input("uncommitted"));
		expect(result.ok && result.value.operation).toBe("merge");
	});

	it("returns the error when an untracked line count fails", async () => {
		const { runner } = changesRunner({
			untracked: ["new.ts"],
			fail: (command) => command.args.includes("--no-index"),
		});
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("git_failed");
	});

	it("returns the error when the upstream probe fails", async () => {
		const { runner } = changesRunner({
			fail: (command) => command.args[0] === "rev-parse" && command.args[1] === "HEAD",
		});
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(false);
	});

	it("returns the error when the upstream distance fails", async () => {
		const { runner } = changesRunner({
			fail: (command) => command.args[0] === "rev-list" && command.args.includes("--left-right"),
		});
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(false);
	});

	it("returns the error when the distance behind the target fails", async () => {
		const { runner } = changesRunner({
			fail: (command) =>
				command.args[0] === "rev-list" &&
				command.args.includes("--count") &&
				!command.args.includes("--left-right"),
		});
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(false);
	});

	it("returns the error when the commit log fails", async () => {
		const { runner } = changesRunner({ fail: (command) => command.args[0] === "log" });
		const result = await refreshWorkspaceChanges(runner, input("full"));
		expect(result.ok).toBe(false);
	});
});
