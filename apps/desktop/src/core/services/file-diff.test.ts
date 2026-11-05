/**
 * @feature REV-02 File diff content
 * Tests the old and new sides, patch forms, guards and cache of the file diff service.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileStat, ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { DiffScope } from "../api.ts";
import type { GitRunner } from "../git/runner.ts";
import { FileDiffService } from "./file-diff.ts";

const workspaceId = "ws-1" as WorkspaceId;
const scope: DiffScope = { kind: "branch" };

const output = (stdout = "", exitCode = 0, stderr = ""): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

interface Replies {
	/** Text of `git show <ref>:<path>`; null means the file is missing at that ref. */
	show?: (ref: string, path: string) => string | null;
	/** Overrides the whole `git show` answer, for git errors other than a missing file. */
	showOutput?: (ref: string, path: string) => ShellOutput;
	numstat?: string;
	trackedPatch?: string;
	untrackedPatch?: string;
}

function runner(replies: Replies = {}) {
	const showCalls: string[] = [];

	const git = new FakeGitRunner((command) => {
		if (command.args[0] === "show") {
			const spec = command.args.at(-1) ?? "";
			showCalls.push(spec);
			const at = spec.indexOf(":");
			const ref = spec.slice(0, at);
			const path = spec.slice(at + 1);
			const override = replies.showOutput?.(ref, path);
			if (override !== undefined) return ok(override);
			const text = replies.show?.(ref, path) ?? null;
			return ok(
				text === null
					? output("", 128, `fatal: path '${path}' does not exist in '${ref}'`)
					: output(text),
			);
		}
		if (command.args.includes("--numstat")) return ok(output(replies.numstat ?? ""));
		if (command.args.includes("--no-index")) return ok(output(replies.untrackedPatch ?? ""));
		return ok(output(replies.trackedPatch ?? ""));
	});
	return { git, commands: git.commands, showCalls };
}

function service(
	git: GitRunner,
	fs: {
		readText: (path: string) => Promise<Result<string>>;
		stat: (path: string) => Promise<Result<FileStat>>;
	},
	scopeResult: Result<{ cwd: string; from: string; to: string | null }> = ok({
		cwd: "/repo",
		from: "base",
		to: null,
	}),
): FileDiffService {
	return new FileDiffService({
		git,
		fs,
		resolveScope: async () => scopeResult,
	});
}

const stat = (modifiedAt: number, size = 10): Result<FileStat> =>
	ok({ path: "/repo/a.ts", isDirectory: false, isSymlink: false, size, modifiedAt });

const missing = (): Promise<Result<FileStat>> =>
	Promise.resolve(err(appError("not_found", "no file")));

describe("REV-02 file diff paths", () => {
	it("refuses a path outside the workspace without reading anything", async () => {
		const { git, commands } = runner();
		let reads = 0;
		const svc = service(git, {
			readText: async () => {
				reads += 1;
				return ok("secret\n");
			},
			stat: async () => {
				reads += 1;
				return stat(1);
			},
		});

		for (const path of ["../outside.txt", "/etc/passwd", "a/../../b"]) {
			const diff = await svc.load(workspaceId, path, scope, {
				withPatch: false,
				ignoreWhitespace: false,
			});
			expect(diff.ok).toBe(false);
			if (!diff.ok) expect(diff.error.code).toBe("path_outside_workspace");
		}
		expect(reads).toBe(0);
		expect(commands).toEqual([]);
	});
});

describe("REV-02 file diff sides", () => {
	it("returns oldText and a null newText for a deleted file", async () => {
		const { git } = runner({
			show: (ref) => (ref === "base" ? "one\ntwo\n" : null),
			numstat: "0\t2\tsrc/a.ts",
		});
		const diff = await service(git, { readText: missingText, stat: missing }).load(
			workspaceId,
			"src/a.ts",
			scope,
			{ withPatch: false, ignoreWhitespace: false },
		);
		expect(diff.ok).toBe(true);
		if (!diff.ok) return;
		expect(diff.value.oldText).toBe("one\ntwo\n");
		expect(diff.value.newText).toBeNull();
	});

	it("reads the new side from disk for a working-tree comparison", async () => {
		const { git, showCalls } = runner({
			show: () => "old\n",
			numstat: "1\t1\tsrc/a.ts",
		});
		const diff = await service(git, {
			readText: async () => ok("new\n"),
			stat: async () => stat(1),
		}).load(workspaceId, "src/a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(diff.ok).toBe(true);
		if (!diff.ok) return;
		expect(diff.value.oldText).toBe("old\n");
		expect(diff.value.newText).toBe("new\n");
		expect(showCalls).toEqual(["base:src/a.ts"]);
	});

	it("returns a null oldText for an added file", async () => {
		const { git } = runner({
			show: () => null,
			numstat: "2\t0\tsrc/new.ts",
		});
		const diff = await service(git, {
			readText: async () => ok("a\nb\n"),
			stat: async () => stat(2),
		}).load(workspaceId, "src/new.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(diff.ok).toBe(true);
		if (!diff.ok) return;
		expect(diff.value.oldText).toBeNull();
		expect(diff.value.newText).toBe("a\nb\n");
	});

	it("reports a git show failure that is not a missing file", async () => {
		const { git } = runner({
			showOutput: () => output("", 128, "fatal: invalid object name 'nope'."),
			numstat: "1\t1\ta.ts",
		});
		const diff = await service(git, {
			readText: async () => ok("new\n"),
			stat: async () => stat(7),
		}).load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(diff.ok).toBe(false);
		if (diff.ok) return;
		expect(diff.error.code).toBe("git_failed");
		expect(diff.error.message).toContain("invalid object name");
	});

	it("returns a disk read failure instead of calling the file binary", async () => {
		const { git } = runner({
			show: () => "old\n",
			numstat: "1\t1\ta.ts",
		});
		const diff = await service(git, {
			readText: async () => err(appError("fs_failed", "permission denied")),
			stat: async () => stat(8),
		}).load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(diff.ok).toBe(false);
		if (diff.ok) return;
		expect(diff.error.code).toBe("fs_failed");
	});

	it("returns binary with no texts", async () => {
		const { git } = runner({ numstat: "-\t-\timg.png" });
		const diff = await service(git, {
			readText: async () => ok("\u0000"),
			stat: async () => stat(3),
		}).load(workspaceId, "img.png", scope, { withPatch: false, ignoreWhitespace: false });
		expect(diff.ok).toBe(true);
		if (!diff.ok) return;
		expect(diff.value.binary).toBe(true);
		expect(diff.value.oldText).toBeNull();
		expect(diff.value.newText).toBeNull();
	});

	it("returns tooLarge with no texts above the guard counts", async () => {
		const { git } = runner({ numstat: "15000\t15000\tbig.ts" });
		const diff = await service(git, {
			readText: async () => ok(""),
			stat: async () => stat(4),
		}).load(workspaceId, "big.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(diff.ok).toBe(true);
		if (!diff.ok) return;
		expect(diff.value.tooLarge).toBe(true);
		expect(diff.value.oldText).toBeNull();
		expect(diff.value.newText).toBeNull();
	});

	it("builds an untracked file's patch against /dev/null", async () => {
		const { git, commands } = runner({
			show: () => null,
			numstat: "",
			trackedPatch: "",
			untrackedPatch: "diff --git a/untracked.ts b/untracked.ts\n",
		});
		const diff = await service(git, {
			readText: async () => ok("hello\n"),
			stat: async () => stat(5),
		}).load(workspaceId, "untracked.ts", scope, {
			withPatch: true,
			ignoreWhitespace: false,
		});
		expect(diff.ok).toBe(true);
		if (!diff.ok) return;
		expect(diff.value.patch).toContain("diff --git");
		expect(commands.some((command) => command.args.includes("--no-index"))).toBe(true);
	});

	it("passes the whitespace flag to the patch command", async () => {
		const { git, commands } = runner({
			show: () => "old\n",
			numstat: "1\t1\ta.ts",
			trackedPatch: "diff --git a/a.ts b/a.ts\n",
		});
		await service(git, {
			readText: async () => ok("new\n"),
			stat: async () => stat(6),
		}).load(workspaceId, "a.ts", scope, { withPatch: true, ignoreWhitespace: true });
		expect(
			commands.some(
				(command) => command.args[0] === "diff" && command.args.includes("--ignore-all-space"),
			),
		).toBe(true);
	});
});

describe("REV-02 file diff cache", () => {
	it("reuses a cached answer and refetches after the modified time changes", async () => {
		const { git, commands } = runner({
			show: () => "old\n",
			numstat: "1\t1\ta.ts",
		});
		let modifiedAt = 10;
		const svc = service(git, {
			readText: async () => ok("new\n"),
			stat: async () => stat(modifiedAt),
		});
		await svc.load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		const afterFirst = commands.length;
		await svc.load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(commands.length).toBe(afterFirst);
		modifiedAt = 11;
		await svc.load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(commands.length).toBeGreaterThan(afterFirst);
	});

	it("warms the cache for prefetched files", async () => {
		const { git, commands } = runner({ show: () => "old\n", numstat: "1\t1\ta.ts" });
		const svc = service(git, {
			readText: async () => ok("new\n"),
			stat: async () => stat(25),
		});
		await svc.prefetch(workspaceId, ["a.ts"], scope);
		const afterPrefetch = commands.length;
		await svc.load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(commands.length).toBe(afterPrefetch);
	});

	it("does not refetch the two texts when only the whitespace preference changes", async () => {
		const { git, commands } = runner({ show: () => "old\n", numstat: "1\t1\ta.ts" });
		const svc = service(git, {
			readText: async () => ok("new\n"),
			stat: async () => stat(40),
		});
		await svc.load(workspaceId, "a.ts", scope, {
			withPatch: false,
			ignoreWhitespace: false,
		});
		const afterFirst = commands.length;
		const second = await svc.load(workspaceId, "a.ts", scope, {
			withPatch: false,
			ignoreWhitespace: true,
		});
		expect(second.ok).toBe(true);
		expect(commands.length).toBe(afterFirst);
	});

	it("keeps the whitespace preference in the key when a patch is built", async () => {
		const { git, commands } = runner({
			show: () => "old\n",
			numstat: "1\t1\ta.ts",
			trackedPatch: "diff --git a/a.ts b/a.ts\n",
		});
		const svc = service(git, {
			readText: async () => ok("new\n"),
			stat: async () => stat(41),
		});
		await svc.load(workspaceId, "a.ts", scope, { withPatch: true, ignoreWhitespace: false });
		const afterFirst = commands.length;
		await svc.load(workspaceId, "a.ts", scope, { withPatch: true, ignoreWhitespace: true });
		expect(commands.length).toBeGreaterThan(afterFirst);
	});

	it("drops a workspace's entries on invalidate", async () => {
		const { git, commands } = runner({
			show: () => "old\n",
			numstat: "1\t1\ta.ts",
		});
		const svc = service(git, {
			readText: async () => ok("new\n"),
			stat: async () => stat(20),
		});
		await svc.load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		svc.invalidate(workspaceId);
		const before = commands.length;
		await svc.load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		expect(commands.length).toBeGreaterThan(before);
	});

	it("does not cache an answer for an older request", async () => {
		const { git } = runner({
			show: () => "old\n",
			numstat: "1\t1\ta.ts",
		});
		let calls = 0;
		let release: (() => void) | undefined;
		let started: () => void = () => {};
		const firstStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const svc = service(git, {
			readText: async () => {
				calls += 1;
				if (calls === 1) {
					started();
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					return ok("first answer\n");
				}
				return ok("second answer\n");
			},
			stat: async () => stat(30),
		});
		const first = svc.load(workspaceId, "a.ts", scope, {
			withPatch: false,
			ignoreWhitespace: false,
		});
		await firstStarted;
		await svc.load(workspaceId, "a.ts", scope, { withPatch: false, ignoreWhitespace: false });
		release?.();
		const older = await first;
		expect(older.ok).toBe(true);
		const third = await svc.load(workspaceId, "a.ts", scope, {
			withPatch: false,
			ignoreWhitespace: false,
		});
		expect(third.ok).toBe(true);
		if (!third.ok) return;
		expect(third.value.newText).toBe("second answer\n");
		expect(calls).toBe(2);
	});
});

async function missingText(): Promise<Result<string>> {
	return err(appError("fs_not_found", "no file"));
}
