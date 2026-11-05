// @vitest-environment node
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/**
 * Answers the read-only commands of one full poll. The branch diverged by five commits ahead and
 * two behind, and the upstream reflog holds the local tip (the remote pointed at it before a
 * force-push moved it), so the remote reads rewritten.
 */
function pollShell(command: ShellCommand): Result<ShellOutput> | null {
	if (command.program === "stat") return output("", "", 1);
	if (command.program !== "git") return null;
	const args = command.args;
	if (args.includes("--show-current")) return output("feature\n");
	if (args.includes("--git-path")) return output(`/git/${args.at(-1) ?? ""}\n`);
	if (args.includes("merge-base")) return output("merge-base\n");
	if (args.includes("--name-status") || args.includes("--numstat")) return output("");
	if (args.includes("status")) return output("");
	if (args.includes("ls-files")) return output("");
	if (args.includes("--symbolic-full-name")) return output("refs/remotes/origin/feature\n");
	if (args.includes("@{u}")) return output("head-oid\nupstream-oid\n");
	if (args.includes("reflog")) return output("upstream-oid\nhead-oid\n");
	if (args.includes("--left-right")) return output("2\t5\n");
	if (args.includes("--count")) return output("4\n");
	if (args.includes("log")) return output("");
	return null;
}

describe("GIT-03 branch sync reaches the live git service", () => {
	it("stores a rewritten remote on the snapshot the screen reads", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container);
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			expect(loaded.ok).toBe(true);
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				branch: "feature",
			});
			harness.memory.controls.scriptShell(pollShell);

			const refreshed = await harness.container.services.git.refresh(workspace.id, "full");
			expect(refreshed.ok).toBe(true);

			const state = harness.container.services.git.stateOf(workspace.id);
			expect(state?.sync).toEqual({
				ahead: 5,
				behind: 2,
				rewritten: true,
				hasUpstream: true,
			});
		} finally {
			harness.container.services.repo.dispose();
			harness.close();
		}
	});
});
