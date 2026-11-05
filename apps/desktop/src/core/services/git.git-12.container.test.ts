// @vitest-environment node
/**
 * @feature GIT-12 Branch lists, branch commits and switch branch
 * Owns: the composition-root test that branch listing and switch branch run through the real
 * container's GitService.
 * Behaviour: services-map.md 3.6.6 (remote branches), 3.11 (fetch, checkout, fast-forward only).
 * Test first: switching a seeded workspace to a remote branch saves the new branch on the row.
 */
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const argv = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

describe("GIT-12 through the real container", () => {
	it("lists the repository's branches and switches a workspace to another one", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container, { rootPath: "/code/projects/git-12" });
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			expect(loaded.ok).toBe(true);
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspaces/git-12",
				branch: "main",
			});

			harness.memory.controls.scriptShell((command) => {
				const args = argv(command);
				if (args[0] === "fetch") return output();
				if (args[0] === "branch" && args[1]?.startsWith("--format")) {
					return output("main\nfeature\n");
				}
				if (args[0] === "branch" && args[1] === "--show-current") return output("feature\n");
				if (args[0] === "for-each-ref") return output("origin/main\norigin/feature\norigin/HEAD\n");
				if (args[0] === "worktree" && args[1] === "list") {
					return output("worktree /code/workspaces/git-12\nHEAD aaa\nbranch refs/heads/main\n");
				}
				if (args[0] === "checkout") return output();
				if (args[0] === "symbolic-ref") return output("refs/heads/feature\n");
				if (args[0] === "show-ref") return output("", "", 0);
				if (args[0] === "merge-base" && args[1] === "--is-ancestor") return output();
				if (args[0] === "merge") return output();
				if (args[0] === "rev-parse" && args[1] === "--git-path") {
					return output(`/git/${args.at(-1)}\n`);
				}
				if (args[0] === "rev-parse") return output("", "fatal: no upstream", 128);
				if (args[0] === "merge-base") return output("mb\n");
				if (args[0] === "diff") return output();
				if (args[0] === "status") return output();
				if (args[0] === "ls-files") return output();
				if (args[0] === "rev-list") return output("0\n");
				if (args[0] === "log") return output("");
				return null;
			});

			const branches = await harness.container.services.git.listBranches(repo.rootPath, "origin");
			expect(branches).toEqual(
				ok({
					local: ["main", "feature"],
					remote: ["main", "feature"],
					checkedOut: ["main"],
				}),
			);

			const switched = await harness.container.services.git.switchBranch(workspace.id, "feature");
			expect(switched).toEqual(ok(undefined));
			expect(
				harness.container.services.workspace.store.getState().workspacesById[workspace.id]?.branch,
			).toBe("feature");
		} finally {
			harness.container.services.repo.dispose();
			harness.close();
		}
	});
});
