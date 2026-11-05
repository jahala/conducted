/**
 * @feature WS-02 Create from a branch, PR or issue
 * Owns: the repository branch list behind the create-from picker.
 * Behaviour: services-map.md 3.1 (workspace create) and ui-map.md 3.9 (the create-from list).
 * Test first: a repository's local branches come back newest first, without empty lines.
 */
import { appError, err } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { FakeGitRunner, gitOutput } from "../../test/fake-git-runner.ts";
import type { GitServiceDeps } from "./git.ts";
import { GitService } from "./git.ts";

describe("WS-02 GitService.listBranches", () => {
	it("returns every local branch, newest commit first", async () => {
		const git = new FakeGitRunner((command) =>
			command.args[0] === "branch" ? gitOutput("feature/login\nmain\n\n") : gitOutput(""),
		);
		// seam: WS-02 listBranches reads only deps.git, so the GitRunner is the whole seam.
		const service = new GitService({ git } as unknown as GitServiceDeps);

		const result = await service.listBranches("/repo");

		expect(result).toEqual({ ok: true, value: ["feature/login", "main"] });
		expect(git.commands[0]?.args).toEqual([
			"branch",
			"--format=%(refname:short)",
			"--sort=-committerdate",
		]);
	});

	it("passes a failed branch read on as an error", async () => {
		const git = new FakeGitRunner(() => err(appError("git_failed", "fatal: not a git repository")));
		// seam: WS-02 listBranches reads only deps.git, so the GitRunner is the whole seam.
		const service = new GitService({ git } as unknown as GitServiceDeps);

		const result = await service.listBranches("/repo");

		expect(!result.ok && result.error.message).toBe("fatal: not a git repository");
	});
});
