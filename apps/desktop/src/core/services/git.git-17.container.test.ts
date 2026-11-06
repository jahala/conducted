// @vitest-environment node
/**
 * @feature GIT-17 Continue after a merge or from a detached HEAD
 * Owns: the composition-root test that Continue runs through the real container's GitService,
 * creates the branch from the target, saves it on the workspace, keeps its chats and leaves the
 * "Branch continued" note.
 * Behaviour: services-map.md 3.1; inventory:toast row 578.
 * Test first: after Continue the workspace has the new branch, both chats still exist and the note
 * is on disk.
 */
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { sessionConfig } from "../db/test-fixtures.ts";

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const argv = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("GIT-17 through the real container", () => {
	it("continues after a merge without losing the chats", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container, { rootPath: "/code/projects/git-17" });
			// The open workspace screen loads its repository's settings (useSetupState) before the
			// git panel can offer Continue; the remote name comes from them (DATA-09).
			must(await harness.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspaces/git-17",
				branch: "feat",
				targetBranch: "origin/main",
			});
			const first = must(
				await harness.container.services.sessions.create(workspace.id, sessionConfig),
			);
			const second = must(
				await harness.container.services.sessions.create(workspace.id, {
					...sessionConfig,
					model: "another-model",
				}),
			);

			harness.memory.controls.scriptShell((command) => {
				const args = argv(command);
				if (args[0] === "branch" && args[1] === "--show-current") return output("feat\n");
				if (args[0] === "fetch") return output();
				if (args[0] === "rev-parse" && args[1] === "refs/remotes/origin/main") {
					return output("target-sha\n");
				}
				if (args[0] === "show-ref") return output("", "", 1);
				if (args[0] === "remote" && args[1] === "get-url") {
					return output("git@example.com:acme/app.git\n");
				}
				if (args[0] === "checkout" && args[1] === "-b") return output();
				return null;
			});

			const sent: string[] = [];
			vi.spyOn(harness.container.services.sessions, "sendInstruction").mockImplementation(
				async (_workspaceId, text) => {
					sent.push(text);
					return ok(first.id);
				},
			);

			const result = await harness.container.actions.git.continueOnNewBranch(
				workspace.id,
				"continued-work",
			);

			expect(result).toEqual(ok(undefined));
			expect(
				harness.container.services.workspace.store.getState().workspacesById[workspace.id]?.branch,
			).toBe("continued-work");
			expect(
				harness.memory.controls.files.get("/code/workspaces/git-17/.context/Branch continued.md"),
			).toContain("continued-work");
			expect(sent[0]).toContain("continued-work");
			expect(harness.container.services.sessions.store.getState().sessions[first.id]).toBeDefined();
			expect(
				harness.container.services.sessions.store.getState().sessions[second.id],
			).toBeDefined();
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});
});
