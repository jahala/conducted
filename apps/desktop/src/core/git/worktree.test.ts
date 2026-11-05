import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileSystem, ShellOutput } from "../../platform/platform.ts";
import type { GitCommand } from "./commands.ts";
import { type GitRunner, isSuccessfulExit } from "./runner.ts";
import {
	BRANCH_CLASH_MESSAGE,
	branchNameIsTaken,
	classifyFetchError,
	createWorktree,
	nextFreeName,
	OFFLINE_FALLBACK_MESSAGE,
	OFFLINE_NO_CACHE_MESSAGE,
	prepareWorktree,
	WORKTREE_CONFIG_SKIPPED_MESSAGE,
} from "./worktree.ts";

const output = (exitCode: number, stdout = "", stderr = ""): ShellOutput => ({
	exitCode,
	stdout,
	stderr,
});

const matches = (command: GitCommand, program: string, args: readonly string[]): boolean =>
	command.program === program &&
	command.args.length === args.length &&
	args.every((arg, index) => command.args[index] === arg);

const starts = (command: GitCommand, program: string, args: readonly string[]): boolean =>
	command.program === program && args.every((arg, index) => command.args[index] === arg);

interface FakeGit {
	git: GitRunner;
	calls: { command: GitCommand; cwd: string }[];
}

function makeRunner(reply: (command: GitCommand, cwd: string) => ShellOutput | undefined): FakeGit {
	const calls: { command: GitCommand; cwd: string }[] = [];
	const answer = (command: GitCommand, cwd: string): ShellOutput =>
		reply(command, cwd) ?? output(0);
	const run: GitRunner["run"] = async (command, options) => {
		calls.push({ command, cwd: options.cwd });
		return ok(answer(command, options.cwd));
	};
	const runChecked: GitRunner["runChecked"] = async (command, options) => {
		const result = await run(command, options);
		if (!result.ok) return result;
		return isSuccessfulExit(command, result.value.exitCode)
			? result
			: err(appError("git_failed", result.value.stderr.trim() || "git failed"));
	};
	const stdout: GitRunner["stdout"] = async (command, options) => {
		const result = await runChecked(command, options);
		return result.ok ? ok(result.value.stdout.trim()) : result;
	};
	return {
		calls,
		git: {
			run,
			runChecked,
			stdout,
			async start() {
				throw new Error("start is not used in these tests");
			},
			async withWorktreeLock(_path, work) {
				return work();
			},
			async withWorktreeAndRepoLocks(_worktree, _root, work) {
				return work();
			},
		},
	};
}

function fakeFs(initial: Record<string, string> = {}) {
	const texts = new Map(Object.entries(initial));
	const made: string[] = [];
	const written: { path: string; text: string }[] = [];
	const fs = {
		async readText(path: string): Promise<Result<string>> {
			const text = texts.get(path);
			return text === undefined ? err(appError("fs_not_found", "missing")) : ok(text);
		},
		async writeTextAtomic(path: string, text: string): Promise<Result<void>> {
			texts.set(path, text);
			written.push({ path, text });
			return ok(undefined);
		},
		async exists() {
			return false;
		},
		async stat() {
			return err(appError("fs_not_found", "missing"));
		},
		async mkdirp(path: string) {
			made.push(path);
			return ok(undefined);
		},
		async readDir() {
			return ok([]);
		},
		async trash() {
			return ok(undefined);
		},
		paths: { home: "/Users/test", appData: "/app", temp: "/tmp", resources: "/res" },
	} satisfies FileSystem;
	return { fs, made, written, texts };
}

describe("WS-01 nextFreeName", () => {
	it("returns the base when it is free", async () => {
		expect(await nextFreeName("oslo", async () => false)).toEqual({ ok: true, value: "oslo" });
	});
	it("adds -v1, -v2 until a name is free", async () => {
		const taken = new Set(["oslo", "oslo-v1"]);
		expect(await nextFreeName("oslo", async (n) => taken.has(n))).toEqual({
			ok: true,
			value: "oslo-v2",
		});
	});
	it("gives up after 1000 tries", async () => {
		const result = await nextFreeName("oslo", async () => true);
		expect(result.ok).toBe(false);
	});
});

describe("WS-01 classifyFetchError", () => {
	it("names a missing remote and a missing base ref", () => {
		expect(classifyFetchError("fatal: 'upstream' does not appear to be a git repository")).toBe(
			"remoteMissing",
		);
		expect(classifyFetchError("fatal: couldn't find remote ref main")).toBe("baseMissing");
	});
	it("names an offline Mac and an auth prompt", () => {
		expect(classifyFetchError("fatal: Could not resolve host: github.com")).toBe("offline");
		expect(classifyFetchError("fatal: could not read Username for 'https://github.com'")).toBe(
			"auth",
		);
	});
});

describe("WS-01 createWorktree", () => {
	it("fetches the base branch and adds the worktree at its commit id", async () => {
		const { git, calls } = makeRunner((command, cwd) => {
			if (matches(command, "git", ["rev-parse", "HEAD"]))
				return output(0, cwd === "/wt" ? "base-sha" : "head-sha");
			if (starts(command, "git", ["fetch"])) return output(0);
			if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
				return output(0, "base-sha");
			if (starts(command, "git", ["worktree", "add"])) return output(0);
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result).toEqual({ ok: true, value: { headSha: "base-sha", warning: null } });
		expect(calls.map((call) => call.command.args[0])).toEqual([
			"rev-parse",
			"fetch",
			"rev-parse",
			"worktree",
			"rev-parse",
		]);
		const add = calls.find((call) => call.command.args[0] === "worktree");
		expect(add?.command.args).toContain("base-sha");
	});

	it("makes an empty initial commit when the repository has no HEAD", async () => {
		const { git, calls } = makeRunner((command, cwd) => {
			if (matches(command, "git", ["rev-parse", "HEAD"]))
				return cwd === "/repo"
					? output(
							128,
							"",
							"fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.",
						)
					: output(0, "abc");
			if (starts(command, "git", ["fetch"])) return output(0);
			if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
				return output(0, "abc");
			if (starts(command, "git", ["worktree", "add"])) return output(0);
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result.ok).toBe(true);
		expect(
			calls.some(
				(call) => call.command.args.join(" ") === "commit --allow-empty -m Initial commit",
			),
		).toBe(true);
	});

	it("falls back to the cached remote ref offline and tells the user", async () => {
		const { git } = makeRunner((command) => {
			if (starts(command, "git", ["fetch"]))
				return output(128, "", "fatal: Could not resolve host: github.com");
			if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
				return output(0, "cached");
			if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "cached");
			if (starts(command, "git", ["worktree", "add"])) return output(0);
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result.ok && result.value.warning).toBe(OFFLINE_FALLBACK_MESSAGE);
	});

	it("turns a failing post-checkout hook into a warning when the worktree exists", async () => {
		const { git } = makeRunner((command) => {
			if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "abc");
			if (starts(command, "git", ["fetch"])) return output(0);
			if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
				return output(0, "abc");
			if (starts(command, "git", ["worktree", "add"]))
				return output(1, "", "post-checkout hook failed");
			if (matches(command, "git", ["worktree", "list", "--porcelain"]))
				return output(0, "worktree /wt\nHEAD abc\nbranch refs/heads/oslo");
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result.ok).toBe(true);
		expect(result.ok && result.value.warning).toContain("post-checkout");
	});

	it("does not make an initial commit when the repository is broken, only when HEAD is unborn", async () => {
		const { git, calls } = makeRunner((command, cwd) => {
			if (matches(command, "git", ["rev-parse", "HEAD"]) && cwd === "/repo")
				return output(128, "", "fatal: not a git repository");
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result.ok).toBe(false);
		expect(calls.some((call) => call.command.args[0] === "commit")).toBe(false);
	});

	it("tells the user the Mac is offline and there is no cached ref", async () => {
		const { git } = makeRunner((command) => {
			if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "head-sha");
			if (starts(command, "git", ["fetch"]))
				return output(128, "", "fatal: Could not resolve host: github.com");
			if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"])) return output(1);
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.message).toBe(OFFLINE_NO_CACHE_MESSAGE);
	});

	it("keeps the real fetch error instead of claiming the base branch is missing", async () => {
		const { git } = makeRunner((command) => {
			if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "head-sha");
			if (starts(command, "git", ["fetch"]))
				return output(128, "", "fatal: cannot lock ref 'refs/remotes/origin/main'");
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.message).toContain("cannot lock ref");
	});

	it("finds an existing worktree through a symlinked root", async () => {
		const { git } = makeRunner((command, cwd) => {
			if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "abc");
			if (starts(command, "git", ["fetch"])) return output(0);
			if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
				return output(0, "abc");
			if (starts(command, "git", ["worktree", "add"]))
				return output(1, "", "post-checkout hook failed");
			if (matches(command, "git", ["worktree", "list", "--porcelain"]))
				return output(0, "worktree /real/root/workspaces/Project/oslo\nHEAD abc");
			if (matches(command, "git", ["rev-parse", "--show-toplevel"]) && cwd === "/wt")
				return output(0, "/real/root/workspaces/Project/oslo");
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result.ok).toBe(true);
		expect(result.ok && result.value.warning).toContain("post-checkout");
	});

	it("gives a friendly message for a branch name clash", async () => {
		const { git } = makeRunner((command) => {
			if (matches(command, "git", ["rev-parse", "HEAD"])) return output(0, "abc");
			if (starts(command, "git", ["fetch"])) return output(0);
			if (matches(command, "git", ["rev-parse", "refs/remotes/origin/main"]))
				return output(0, "abc");
			if (starts(command, "git", ["worktree", "add"]))
				return output(
					128,
					"",
					"fatal: cannot lock ref 'refs/heads/alex/oslo': 'refs/heads/alex' exists; cannot create 'refs/heads/alex/oslo'",
				);
			if (matches(command, "git", ["worktree", "list", "--porcelain"])) return output(0, "");
			return undefined;
		});

		const result = await createWorktree(git, {
			repoRootPath: "/repo",
			remote: "origin",
			baseBranch: "main",
			newBranch: "alex/oslo",
			worktreePath: "/wt",
			allowLocalBase: false,
		});

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.message).toBe(BRANCH_CLASH_MESSAGE);
	});
});

describe("WS-01 prepareWorktree", () => {
	it("enables worktree config, sets the upstream, and excludes .context", async () => {
		const { git, calls } = makeRunner((command) => {
			if (matches(command, "git", ["config", "--local", "--get", "core.worktree"]))
				return output(1);
			if (matches(command, "git", ["config", "--local", "--get", "core.bare"])) return output(1);
			if (matches(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
			return undefined;
		});
		const { fs, made, texts } = fakeFs();

		const result = await prepareWorktree(git, {
			repoRootPath: "/repo",
			worktreePath: "/wt",
			autoSetupUpstream: true,
			fs,
		});

		expect(result).toEqual({ ok: true, value: { warning: null } });
		expect(made).toContain("/wt/.context");
		expect(texts.get("/wt/.git/info/exclude")).toBe(".context/\n");
		expect(
			calls.some(
				(call) =>
					call.command.args.join(" ") === "config extensions.worktreeConfig true" &&
					call.cwd === "/repo",
			),
		).toBe(true);
		expect(
			calls.some(
				(call) =>
					call.command.args.join(" ") === "config --worktree push.autoSetupRemote true" &&
					call.cwd === "/wt",
			),
		).toBe(true);
	});

	it("skips worktree config and warns when core.worktree is set", async () => {
		const { git, calls } = makeRunner((command) => {
			if (matches(command, "git", ["config", "--local", "--get", "core.worktree"]))
				return output(0, "yes");
			if (matches(command, "git", ["config", "--local", "--get", "core.bare"])) return output(1);
			if (matches(command, "git", ["config", "--worktree", "--get", "push.autoSetupRemote"]))
				return output(1);
			if (matches(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
			return undefined;
		});
		const { fs } = fakeFs();

		const result = await prepareWorktree(git, {
			repoRootPath: "/repo",
			worktreePath: "/wt",
			autoSetupUpstream: true,
			fs,
		});

		expect(result).toEqual({ ok: true, value: { warning: WORKTREE_CONFIG_SKIPPED_MESSAGE } });
		expect(calls.some((call) => call.command.args.includes("extensions.worktreeConfig"))).toBe(
			false,
		);
	});

	it("stays quiet when core.worktree is set but the upstream is already configured", async () => {
		const { git } = makeRunner((command) => {
			if (matches(command, "git", ["config", "--local", "--get", "core.worktree"]))
				return output(0, "yes");
			if (matches(command, "git", ["config", "--local", "--get", "core.bare"])) return output(1);
			if (matches(command, "git", ["config", "--worktree", "--get", "push.autoSetupRemote"]))
				return output(0, "true");
			if (matches(command, "git", ["rev-parse", "--git-common-dir"])) return output(0, ".git");
			return undefined;
		});
		const { fs } = fakeFs();

		const result = await prepareWorktree(git, {
			repoRootPath: "/repo",
			worktreePath: "/wt",
			autoSetupUpstream: true,
			fs,
		});

		expect(result).toEqual({ ok: true, value: { warning: null } });
	});
});

describe("WS-01 branchNameIsTaken", () => {
	it("is true for a local branch", async () => {
		const { git } = makeRunner((command) => {
			if (matches(command, "git", ["show-ref", "--verify", "--quiet", "refs/heads/oslo"]))
				return output(0);
			return output(1);
		});
		expect(
			await branchNameIsTaken(git, { repoRootPath: "/repo", remote: "origin", name: "oslo" }),
		).toBe(true);
	});

	it("is true for a remote branch", async () => {
		const { git } = makeRunner((command) => {
			if (matches(command, "git", ["show-ref", "--verify", "--quiet", "refs/remotes/origin/oslo"]))
				return output(0);
			return output(1);
		});
		expect(
			await branchNameIsTaken(git, { repoRootPath: "/repo", remote: "origin", name: "oslo" }),
		).toBe(true);
	});

	it("is false when neither branch exists", async () => {
		const { git } = makeRunner(() => output(1));
		expect(
			await branchNameIsTaken(git, { repoRootPath: "/repo", remote: "origin", name: "oslo" }),
		).toBe(false);
	});
});
