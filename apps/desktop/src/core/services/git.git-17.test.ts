/**
 * @feature GIT-17 Continue after a merge or from a detached HEAD
 * Owns: tests for `GitService.continueOnNewBranch`: the start point after a merge or from a
 * detached HEAD, the free branch name, the workspace branch save, the "Branch continued" note and
 * its chat message, and the failure message when that note cannot be attached.
 * Behaviour: services-map.md 3.1 (new branch from the target or HEAD with `checkout -b`);
 * inventory:toast row 578 (the note and "Failed to attach continue context").
 * Test first: a detached HEAD continues from its own commit, and a merged branch from the target.
 */
import {
	appError,
	err,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import { GitService, type WorkspaceGitContext } from "./git.ts";

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

const workspaceId = "ws-git-17" as WorkspaceId;
const sessionId = "chat-git-17" as SessionId;
const workspacePath = "/repo/worktree";

const context = (): WorkspaceGitContext => ({
	workspaceId,
	workspacePath,
	repoRootPath: "/repo",
	remote: "origin",
	targetBranch: "origin/main",
	branch: "feat",
});

interface Sent {
	workspaceId: WorkspaceId;
	text: string;
}

interface Harness {
	service: GitService;
	runner: FakeGitRunner;
	saved: string[];
	sent: Sent[];
	files: Map<string, string>;
}

function harness(options: {
	currentBranch: string;
	headSha: string;
	targetSha: string;
	write?: (path: string, text: string) => Promise<Result<void>>;
	send?: (workspaceId: WorkspaceId) => Promise<Result<SessionId>>;
	save?: (branch: string) => Promise<Result<void>>;
	now?: () => number;
}): Harness {
	const saved: string[] = [];
	const sent: Sent[] = [];
	const files = new Map<string, string>();
	const runner = new FakeGitRunner((command: GitCommand) => {
		const [first, second] = command.args;
		if (first === "branch" && second === "--show-current") {
			return ok(output(options.currentBranch === "" ? "" : `${options.currentBranch}\n`));
		}
		if (first === "rev-parse" && second === "HEAD") return ok(output(`${options.headSha}\n`));
		if (first === "fetch") return ok(output(""));
		if (first === "rev-parse" && second?.startsWith("refs/remotes/")) {
			return ok(output(`${options.targetSha}\n`));
		}
		if (first === "show-ref") return ok(output("", "", 1));
		if (first === "remote" && second === "get-url") {
			return ok(output("git@example.com:acme/app.git\n"));
		}
		if (first === "checkout" && second === "-b") return ok(output(""));
		if (first === "checkout" && command.args.length === 2) return ok(output(""));
		if (first === "branch" && second === "-D") return ok(output(""));
		return err(appError("git_unscripted", `unexpected command: ${command.args.join(" ")}`));
	});
	const fs: Pick<
		FileSystem,
		"trash" | "readText" | "writeTextAtomic" | "mkdirp" | "stat" | "paths"
	> = {
		trash: async () => ok(undefined),
		readText: async () => err(appError("fs_not_found", "missing")),
		writeTextAtomic: async (path, text) => {
			if (options.write !== undefined) return options.write(path, text);
			files.set(path, text);
			return ok(undefined);
		},
		mkdirp: async () => ok(undefined),
		stat: async () => err(appError("fs_not_found", "missing")),
		paths: { home: "", appData: "", temp: "", resources: "" },
	};
	const service = new GitService({
		git: runner,
		cache: {} as never,
		contextOf: async () => ok(context()),
		agent: {
			sendInstruction: async (id: WorkspaceId, text: string) => {
				sent.push({ workspaceId: id, text });
				return options.send === undefined ? ok(sessionId) : options.send(id);
			},
		},
		renameWorkspaceBranch: async (_id, branch) => {
			if (options.save !== undefined) return options.save(branch);
			saved.push(branch);
			return ok(undefined);
		},
		setIntendedTargetBranch: async () => ok(undefined),
		moveOpenPullRequestBase: async () => ok(false),
		now: options.now ?? (() => 0),
		fs,
	});
	return { service, runner, saved, sent, files };
}

describe("GIT-17 continue a detached HEAD", () => {
	it("creates a branch from HEAD, saves it and writes the continuation note", async () => {
		const h = harness({ currentBranch: "", headSha: "head-sha", targetSha: "target-sha" });
		const result = await h.service.continueOnNewBranch(workspaceId, "continued-work");

		expect(result).toEqual(ok(undefined));
		const checkout = h.runner.commands.find(
			(command) => command.args[0] === "checkout" && command.args[1] === "-b",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "continued-work", "head-sha"]);
		expect(h.saved).toEqual(["continued-work"]);
		const note = h.files.get(`${workspacePath}/.context/Branch continued.md`);
		expect(note).toContain("# Branch continued");
		expect(note).toContain("detached HEAD");
		expect(note).toContain("continued-work");
		expect(h.sent).toEqual([{ workspaceId, text: expect.stringContaining("continued-work") }]);
	});
});

describe("GIT-17 continue after a merge", () => {
	it("creates the new branch from the fetched target and keeps the same workspace", async () => {
		const h = harness({ currentBranch: "feat", headSha: "head-sha", targetSha: "target-sha" });
		const result = await h.service.continueOnNewBranch(workspaceId, "continued-work");

		expect(result).toEqual(ok(undefined));
		const fetch = h.runner.commands.find((command) => command.args[0] === "fetch");
		expect(fetch?.args).toContain("+refs/heads/main:refs/remotes/origin/main");
		const checkout = h.runner.commands.find(
			(command) => command.args[0] === "checkout" && command.args[1] === "-b",
		);
		expect(checkout?.args).toEqual(["checkout", "-b", "continued-work", "target-sha"]);
		expect(h.saved).toEqual(["continued-work"]);
		const note = h.files.get(`${workspacePath}/.context/Branch continued.md`);
		expect(note).toContain("branch feat");
		expect(note).toContain("started from main");
		expect(h.sent[0]?.workspaceId).toBe(workspaceId);
	});

	it("uses the current branch name when no name is given", async () => {
		const h = harness({ currentBranch: "feat", headSha: "head-sha", targetSha: "target-sha" });
		await h.service.continueOnNewBranch(workspaceId, null);

		const checkout = h.runner.commands.find(
			(command) => command.args[0] === "checkout" && command.args[1] === "-b",
		);
		expect(checkout?.args[2]).toBe("feat");
	});
});

describe("GIT-17 continue note failures", () => {
	it("reports the attach message when the note cannot be written", async () => {
		const failure = appError("fs_write_failed", "disk is full");
		const h = harness({
			currentBranch: "feat",
			headSha: "head-sha",
			targetSha: "target-sha",
			write: async () => err(failure),
		});
		const result = await h.service.continueOnNewBranch(workspaceId, "continued-work");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("continue_note_failed");
		expect(result.error.message).toBe("Failed to attach continue context");
		expect(h.saved).toEqual(["continued-work"]);
		expect(h.sent).toEqual([]);
	});

	it("reports the attach message when the note cannot reach the chat", async () => {
		const h = harness({
			currentBranch: "feat",
			headSha: "head-sha",
			targetSha: "target-sha",
			send: async () => err(appError("chat_send_failed", "no chat")),
		});
		const result = await h.service.continueOnNewBranch(workspaceId, "continued-work");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("Failed to attach continue context");
		expect(h.saved).toEqual(["continued-work"]);
	});
});

describe("GIT-17 a branch the workspace could not save", () => {
	it("checks the old branch out again and removes the new one", async () => {
		const failure = appError("db.locked", "The database is locked.");
		const h = harness({
			currentBranch: "feat",
			headSha: "head-sha",
			targetSha: "target-sha",
			save: async () => err(failure),
		});

		const result = await h.service.continueOnNewBranch(workspaceId, "continued-work");

		expect(result).toEqual(err(failure));
		const after = h.runner.commands
			.map((command) => command.args)
			.filter((args) => args[0] === "checkout" || (args[0] === "branch" && args[1] === "-D"));
		expect(after).toEqual([
			["checkout", "-b", "continued-work", "target-sha"],
			["checkout", "feat"],
			["branch", "-D", "--", "continued-work"],
		]);
		expect(h.sent).toEqual([]);
		expect(h.files.size).toBe(0);
		expect(h.service.store.getState().continuedAt[workspaceId]).toBeUndefined();
	});

	it("goes back to the detached commit when HEAD was detached", async () => {
		const h = harness({
			currentBranch: "",
			headSha: "head-sha",
			targetSha: "target-sha",
			save: async () => err(appError("db.locked", "The database is locked.")),
		});

		await h.service.continueOnNewBranch(workspaceId, "continued-work");

		expect(
			h.runner.commands.some((command) => command.args.join(" ") === "checkout head-sha"),
		).toBe(true);
	});
});

describe("GIT-17 the merged pull request after a continue", () => {
	const merged = {
		pullRequest: {
			number: 12,
			url: "https://github.com/acme/app/pull/12",
			title: "A change",
			body: "",
			state: "merged" as const,
			mergeable: "mergeable" as const,
			reviewDecision: null,
			checks: [],
			inMergeQueue: false,
			autoMergeEnabled: false,
			baseBranch: "main",
			authorLogin: null,
			viewerDidAuthor: false,
			viewerCanMerge: true,
			mergeMethod: "squash" as const,
			reviewers: [],
			deployments: [],
			updatedAt: 0,
		},
		unavailable: "none" as const,
		fetchedAt: 5,
	};

	const showSnapshot = (service: GitService, branch: string): void => {
		service.store.setState({
			byWorkspace: {
				[workspaceId]: {
					snapshot: {
						depth: "full",
						branch,
						mergeBase: "abc123",
						mergeBaseError: null,
						files: [],
						conflictedPaths: [],
						untrackedTruncated: false,
						uncommittedFiles: 0,
						changedFiles: 0,
						operation: "none",
						commits: [],
						sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
						behindTarget: 0,
					},
					error: null,
					refreshedAt: 1,
				},
			},
		});
	};

	it("leaves out a merged pull request read before the continue, and keeps a newer read", async () => {
		const h = harness({
			currentBranch: "feat",
			headSha: "head-sha",
			targetSha: "target-sha",
			now: () => 10,
		});
		showSnapshot(h.service, "feat");
		expect(h.service.stateOf(workspaceId, merged)?.pullRequest?.state).toBe("merged");

		expect(await h.service.continueOnNewBranch(workspaceId, "continued-work")).toEqual(
			ok(undefined),
		);
		showSnapshot(h.service, "continued-work");

		const after = h.service.stateOf(workspaceId, merged);
		expect(after?.pullRequest).toBeNull();
		expect(after?.pullRequestUnavailable).toBe("none");
		expect(h.service.stateOf(workspaceId, { ...merged, fetchedAt: 11 })?.pullRequest?.state).toBe(
			"merged",
		);
	});
});
