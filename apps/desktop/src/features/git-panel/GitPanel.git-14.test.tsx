/**
 * @feature GIT-14 Local-git forge: header state and the merge request to the agent
 * Owns: tests of the Git panel over the real container for a repository with no GitHub remote and
 * the local-git forge switched on: the panel asks the forge for its ahead count and merge probe,
 * the header reads "Ready to merge", and Merge sends the agent the merge instruction instead of
 * calling GitHub.
 * Behaviour: services-map.md 3.7.7 (synthesised PR info, "Merge" is an agent instruction), 6 (the
 * switch).
 * Test first: with the switch on and a branch two commits ahead, the header offers Merge, and
 * pressing it sends the agent "Merge the branch".
 */
import { ok, type Result, type SessionId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import type { ChangesSnapshot } from "../../core/git/status.ts";
import type { ShellOutput } from "../../platform/platform.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { GitPanel } from "./GitPanel.tsx";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

/** A full poll of a clean branch with two commits the target does not have. */
const snapshot: ChangesSnapshot = {
	depth: "full",
	branch: "feature/local",
	mergeBase: "abc123",
	mergeBaseError: null,
	files: [],
	conflictedPaths: [],
	untrackedTruncated: false,
	uncommittedFiles: 0,
	changedFiles: 2,
	operation: "none",
	commits: [],
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: false },
	behindTarget: 0,
};

describe("GIT-14 the Git panel with the local-git forge switched on", () => {
	it("reads Ready to merge and sends the agent the merge instruction", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, {
				rootPath: "/code/projects/panel-git-14",
				remoteUrl: null,
			});
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/panel-git-14",
				branch: "feature/local",
				targetBranch: "origin/main",
			});
			must(await test.container.services.settings.set("local_git_forge_enabled", true));
			test.container.services.git.store.setState({
				byWorkspace: { [workspace.id]: { snapshot, error: null, refreshedAt: 1 } },
			});
			const forgeCalls: string[] = [];
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "git") return null;
				const args = command.args[0] === "-c" ? command.args.slice(2) : command.args;
				if (args[0] === "rev-list") {
					forgeCalls.push("rev-list");
					return output("0\t2\n");
				}
				if (args[0] === "merge-tree") {
					forgeCalls.push("merge-tree");
					return output("tree-oid\n");
				}
				return null;
			});
			const sendInstruction = vi
				.spyOn(test.container.services.sessions, "sendInstruction")
				.mockResolvedValue(ok("chat-1" as SessionId));
			const merge = vi.spyOn(test.container.actions.pullRequests, "merge");

			const rootRoute = createRootRoute();
			const route = createRoute({
				getParentRoute: () => rootRoute,
				path: "/",
				component: () => (
					<CommandDispatcher>
						<GitPanel workspaceId={workspace.id} />
					</CommandDispatcher>
				),
			});
			const router = createRouter({
				routeTree: rootRoute.addChildren([route]),
				history: createMemoryHistory({ initialEntries: ["/"] }),
			});
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RouterProvider router={router} />
					</AppProviders>
				</ServicesProvider>,
			);
			await router.load();

			expect((await screen.findAllByText("Ready to merge")).length).toBeGreaterThan(0);
			expect(forgeCalls).toContain("rev-list");
			expect(forgeCalls).toContain("merge-tree");

			fireEvent.click(await screen.findByRole("button", { name: "Merge" }));

			await waitFor(() => expect(sendInstruction).toHaveBeenCalledTimes(1));
			const [target, text] = sendInstruction.mock.calls[0] ?? [];
			expect(target).toBe(workspace.id);
			expect(text).toContain("Merge the branch `feature/local` into");
			expect(text).toContain("keep the merge local and do not open a pull request");
			expect(merge).not.toHaveBeenCalled();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});
