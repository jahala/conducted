// @vitest-environment node
/**
 * @feature GIT-14 Local-git forge for repositories without GitHub
 * Owns: the composition-root test that the local-git forge runs through the real container,
 * reads ahead and merge state from the workspace with no GitHub remote, stores the newest answer,
 * and asks the agent to merge into the target.
 * Behaviour: services-map.md 3.7.7, 5B.1.5 and section 6.
 * Test first: the seeded local repository reports ahead 2, behind 1 and DIRTY through the
 * container's LocalGitForge.
 */
import { ok, type Result, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const argv = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

describe("GIT-14 through the real container", () => {
	it("reads the local forge through the container and tells the agent to merge", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container, {
				rootPath: "/code/projects/git-14",
				remoteUrl: null,
			});
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			expect(loaded.ok).toBe(true);
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspaces/git-14",
				branch: "feature/local",
				targetBranch: "origin/main",
			});

			harness.memory.controls.scriptShell((command) => {
				const args = argv(command);
				if (args[0] === "rev-list") return output("1\t2\n");
				if (args[0] === "merge-tree") return output("tree-oid\n", "", 1);
				return null;
			});

			const forge = harness.container.services.localGitForge;
			const off = await forge.synthesizePrInfo(workspace.id);
			expect(!off.ok && off.error.code).toBe("local_git_forge_off");

			const saved = await harness.container.services.settings.set("local_git_forge_enabled", true);
			expect(saved.ok).toBe(true);

			const info = await forge.synthesizePrInfo(workspace.id);
			expect(info).toEqual(ok({ ahead: 2, behind: 1, mergeState: "DIRTY" }));

			const refreshed = await forge.refresh(workspace.id);
			expect(refreshed).toEqual(ok({ ahead: 2, behind: 1, mergeState: "DIRTY" }));
			expect(forge.store.getState().byWorkspace[String(workspace.id)]?.info).toEqual({
				ahead: 2,
				behind: 1,
				mergeState: "DIRTY",
			});

			const sent: string[] = [];
			vi.spyOn(harness.container.services.sessions, "sendInstruction").mockImplementation(
				async (_workspaceId, text) => {
					sent.push(text);
					return ok("session-git-14" as SessionId);
				},
			);

			expect(await forge.mergeIntoTarget(workspace.id)).toEqual(ok(undefined));
			expect(sent).toHaveLength(1);
			expect(sent[0]).toContain("feature/local");
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});
});
