/**
 * @feature PR-06 Merge, auto-merge, ready for review, approve
 * Owns: the test that a pull request action's progress reaches a screen while it runs.
 * Behaviour: services-map.md 5B.1.5 and 5B.1.7 (the pending action state layered over the PR).
 * Test first: useGitState shows "merging" while a merge waits on GitHub, then null once it ends.
 */
import { ok, type Result } from "@conducted/shared";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import { useGitState } from "./git.ts";

let test: TestContainer | null = null;

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	if (test !== null) {
		await test.container.stop();
		test.close();
	}
	test = null;
});

const output = (stdout = ""): Result<ShellOutput> => ok({ stdout, stderr: "", exitCode: 0 });

/** The git arguments after the runner's `-c core.quotePath=false`. */
const gitArgs = (command: ShellCommand): readonly string[] =>
	command.program === "git" ? command.args.slice(2) : command.args;

describe("PR-06 pending action reaches the screen", () => {
	it("re-renders with 'merging' while the merge runs, and with null once it ends", async () => {
		test = createTestContainer();
		const { container, memory } = test;
		const repo = await seedRepo(container, { rootPath: "/code/pr-06" });
		const workspace = await seedWorkspace(container, {
			repoId: repo.id,
			path: "/code/pr-06/workspace",
			branch: "feat",
		});
		const loaded = await container.services.repo.loadConfig(repo.id);
		expect(loaded.ok).toBe(true);
		container.services.workspace.store.setState((state) => ({
			workspacesById: { ...state.workspacesById, [workspace.id]: { ...workspace, prNumber: 12 } },
		}));
		container.services.git.store.setState({
			byWorkspace: {
				[workspace.id]: {
					snapshot: {
						depth: "full",
						branch: "feat",
						mergeBase: "abc123",
						mergeBaseError: null,
						files: [],
						conflictedPaths: [],
						untrackedTruncated: false,
						uncommittedFiles: 0,
						changedFiles: 0,
						operation: "none",
						commits: [],
						sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
						behindTarget: 0,
					},
					error: null,
					refreshedAt: 1,
				},
			},
		});
		memory.controls.scriptShell((command) => {
			const args = gitArgs(command);
			if (command.program === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
				return output("abc123\n");
			}
			if (command.program === "git" && args[0] === "rev-parse") return output(".git\n");
			if (command.program === "gh" && args.some((arg) => arg.includes("squashMergeAllowed"))) {
				return output("[true,true,true]\n");
			}
			return output();
		});
		// The merge call waits until the test releases it, the way a slow GitHub answer looks.
		let release: (() => void) | undefined;
		const answered = new Promise<void>((resolve) => {
			release = resolve;
		});
		let reached: (() => void) | undefined;
		const mergeSent = new Promise<void>((resolve) => {
			reached = resolve;
		});
		const shell = memory.platform.shell;
		const scripted = shell.run.bind(shell);
		// seam: PR-06 the shell is the outside world; holding one gh call open is a slow GitHub.
		vi.spyOn(shell, "run").mockImplementation(async (command) => {
			if (command.program === "gh" && command.args[0] === "pr" && command.args[1] === "merge") {
				reached?.();
				await answered;
			}
			return scripted(command);
		});
		const wrapper = ({ children }: { children: ReactNode }) => (
			<ServicesProvider container={container}>{children}</ServicesProvider>
		);
		const { result } = renderHook(() => useGitState(workspace.id), { wrapper });
		expect(result.current).toMatchObject({
			state: "ready",
			data: { pendingPullRequestAction: null },
		});

		const merging = container.actions.pullRequests.merge(workspace.id);
		await mergeSent;

		await waitFor(() =>
			expect(result.current).toMatchObject({
				state: "ready",
				data: { pendingPullRequestAction: "merging" },
			}),
		);

		release?.();
		expect(await merging).toEqual(ok(undefined));
		await waitFor(() =>
			expect(result.current).toMatchObject({
				state: "ready",
				data: { pendingPullRequestAction: null },
			}),
		);
	});
});
