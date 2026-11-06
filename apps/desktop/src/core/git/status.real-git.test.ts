import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appError, err, ok, type WorkspaceId } from "@conducted/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Shell, ShellCommand } from "../../platform/platform.ts";
import { KeyedMutex } from "./locks.ts";
import { ShellGitRunner } from "./runner.ts";
import { refreshWorkspaceChanges } from "./status.ts";

// A Shell over node's execFile, so the parsers meet the output of the real git binary.
const realShell: Shell = {
	run: (command: ShellCommand) =>
		new Promise((resolve) => {
			execFile(
				command.program,
				[...command.args],
				{ cwd: command.cwd, env: { ...process.env, ...command.env }, maxBuffer: 16 * 1024 * 1024 },
				(error, stdout, stderr) => {
					if (error !== null && typeof error.code !== "number") {
						resolve(err(appError("process_spawn", error.message)));
						return;
					}
					resolve(ok({ exitCode: error === null ? 0 : (error.code as number), stdout, stderr }));
				},
			);
		}),
	start: () => {
		throw new Error("start is not used here");
	},
	loginEnv: async () => ({ shell: "/bin/zsh", path: process.env.PATH ?? "", zdotdir: null }),
};

const runner = new ShellGitRunner({
	shell: realShell,
	locks: new KeyedMutex(),
	// No app bin folder: these tests run git and gh from the PATH alone.
	programsBin: "",
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	log: () => undefined,
});

let root: string;
const git = (...args: string[]): void => {
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd: root, stdio: "pipe" },
	);
};

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "conducted-real-git-"));
	git("init", "-q", "-b", "main");
	writeFileSync(join(root, "plain.txt"), "one\ntwo\n");
	writeFileSync(join(root, "old name.txt"), "a\nb\nc\nd\ne\nf\ng\nh\n");
	writeFileSync(join(root, "café.txt"), "x\n");
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\nexport const b = 2;\n");
	git("add", "-A");
	git("commit", "-q", "-m", "base");
	git("checkout", "-q", "-b", "feature");
	git("mv", "old name.txt", "src/new name.txt");
	writeFileSync(join(root, "plain.txt"), "one\ntwo\nthree\n");
	writeFileSync(join(root, "café.txt"), "x\ny\n");
	git("add", "-A");
	git("commit", "-q", "-m", "work | in progress");
	writeFileSync(join(root, "untracked file.txt"), "1\n2\n3\n");
	writeFileSync(join(root, "logo.bin"), Buffer.from([0, 1, 2, 0, 255, 0, 3]));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("GIT-02 refresh against a real repository", () => {
	it("reads renames, non-ASCII names, untracked files, binary files and the commit log", async () => {
		const result = await refreshWorkspaceChanges(runner, {
			workspaceId: "w1" as WorkspaceId,
			workspacePath: root,
			targetRef: "main",
			remote: "origin",
			depth: "full",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const byPath = new Map(result.value.files.map((file) => [file.path, file]));
		expect(byPath.get("src/new name.txt")).toMatchObject({
			status: "renamed",
			oldPath: "old name.txt",
		});
		expect(byPath.get("plain.txt")).toMatchObject({ status: "modified", linesAdded: 1 });
		expect(byPath.get("café.txt")).toMatchObject({ status: "modified", linesAdded: 1 });
		expect(byPath.get("untracked file.txt")).toMatchObject({
			status: "added",
			linesAdded: 3,
			binary: false,
		});
		expect(byPath.get("logo.bin")).toMatchObject({ status: "added", binary: true, linesAdded: 0 });
		expect(result.value.branch).toBe("feature");
		expect(result.value.operation).toBe("none");
		expect(result.value.sync.hasUpstream).toBe(false);
		expect(result.value.commits.map((commit) => commit.subject)).toEqual(["work | in progress"]);
	});
});
