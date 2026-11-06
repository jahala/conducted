// @vitest-environment node
/**
 * @feature PR-10 Link a pull request by URL or number
 * Owns: the composition-root test that `Actions.pullRequests.link` reaches the GitHub service and
 * writes the pull request number and title onto the workspace in the real container.
 * Behaviour: ui-map.md 3.1 and 3.10; services-map.md 2.5.2.
 * Test first: linking pull request 123 stores number 123 and its title on the workspace.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const remoteUrl = "https://github.com/octo/repo.git";
const prJson = JSON.stringify({
	number: 123,
	title: "Link me",
	html_url: "https://github.com/octo/repo/pull/123",
	state: "open",
	draft: false,
	merged_at: null,
	updated_at: "2026-11-05T09:00:00Z",
	body: "The pull request body",
	user: { login: "ada", avatar_url: "https://avatars.example/ada.png" },
	head: { ref: "feature/link" },
});

describe("PR-10 link through the real container", () => {
	it("stores the linked pull request on the workspace", async () => {
		const harness = createTestContainer();
		try {
			const repo = await seedRepo(harness.container, {
				rootPath: "/code/projects/pr-10",
				remoteUrl,
			});
			const loaded = await harness.container.services.repo.loadConfig(repo.id);
			expect(loaded.ok).toBe(true);
			const workspace = await seedWorkspace(harness.container, {
				repoId: repo.id,
				path: "/code/workspaces/pr-10",
				branch: "feature/link",
			});
			harness.memory.controls.scriptShell((command) => {
				if (command.program === "git" && command.args.includes("get-url")) {
					return ok({ exitCode: 0, stdout: `${remoteUrl}\n`, stderr: "" });
				}
				if (
					command.program === "gh" &&
					command.args[0] === "api" &&
					command.args[1]?.endsWith("/pulls/123") === true
				) {
					return ok({ exitCode: 0, stdout: prJson, stderr: "" });
				}
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});

			const linked = await harness.container.actions.pullRequests.link(
				workspace.id,
				"https://github.com/octo/repo/pull/123",
			);

			expect(linked).toEqual(ok(undefined));
			const stored =
				harness.container.services.workspace.store.getState().workspacesById[workspace.id];
			expect(stored?.prNumber).toBe(123);
			expect(stored?.prTitle).toBe("Link me");
			expect(stored?.prDescription).toBeNull();
		} finally {
			await harness.container.stop();
			harness.close();
		}
	});
});
