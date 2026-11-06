/**
 * @feature PR-08 Stacked PRs and read-only Graphite
 * Owns: the container tests that the git panel polls Graphite only for the repository of the
 * workspace it shows, releases that poll when it unmounts, runs `gh stack merge` from the
 * header's "Merge stack", offers that merge only when the stack's readiness allows it, and that
 * the header's Resolve on a branch incompatible with its remote runs `gh stack sync` for a
 * stacked pull request, asking the agent only when the sync fails or the branch is not stacked.
 * Behaviour: services-map.md 3.8.1 (`gt state` every 5 s for the visible workspace's repository),
 * 3.8.2 (`gh stack merge`, `gh stack sync`, readiness per stack entry), ui-map.md 3.6 ("Merge
 * stack" for stacks, "Incompatible with remote" with Resolve).
 * Test first: mounting the panel runs `gt state` in the workspace's repository.
 */
import { ok, type SessionId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import type { BranchSync, PullRequest, Workspace } from "../../core/model.ts";
import type { ShellCommand } from "../../platform/platform.ts";
import {
	createTestContainer,
	seedPullRequest,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { GitPanel } from "./GitPanel.tsx";

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

const ROOT = "/code/projects/pr-08-panel";
const output = (stdout = "", stderr = "", exitCode = 0) => ok({ stdout, stderr, exitCode });

const pullRequest: PullRequest = {
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "Use the parser",
	body: "",
	state: "open",
	mergeable: "mergeable",
	reviewDecision: null,
	checks: [],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "octocat",
	viewerDidAuthor: true,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
};

const stackAnswer = JSON.stringify({
	data: {
		repository: {
			pullRequest: {
				number: 12,
				stackEntry: { position: 2, stack: { number: 5, size: 2, baseRefName: "main" } },
			},
		},
	},
});

const notStackedAnswer = JSON.stringify({
	data: { repository: { pullRequest: { number: 12, stackEntry: null } } },
});

const membersAnswer = JSON.stringify({
	pull_requests: [
		{
			number: 11,
			title: "Add the parser",
			state: "OPEN",
			draft: false,
			head: { ref: "feat-a", sha: "a1" },
			base: { ref: "main", sha: "m0" },
		},
		{
			number: 12,
			title: "Use the parser",
			state: "OPEN",
			draft: false,
			head: { ref: "feat-b", sha: "b1" },
			base: { ref: "feat-a", sha: "a1" },
		},
	],
});

/** GitHub's merge state of #11 and #12, as the stack readiness query returns it. */
const readinessAnswer = (lower: string, upper: string) =>
	JSON.stringify({
		data: {
			repository: {
				pr0: { number: 11, mergeStateStatus: lower },
				pr1: { number: 12, mergeStateStatus: upper },
			},
		},
	});

/**
 * A clean, pushed workspace whose pull request #12 is ready to merge and sits in a stack of two.
 * GitHub reports the lower pull request #11 with `lowerState`. `sync` is the branch against its
 * remote, `stacked: false` puts #12 outside any stack, `stackSync` answers `gh stack sync`, and
 * `graphiteState` is what `gt state` prints, and `git` answers a command first when it returns one.
 */
async function seedPanel(
	lowerState = "CLEAN",
	options: {
		sync?: BranchSync;
		stacked?: boolean;
		stackSync?: ReturnType<typeof output>;
		graphiteState?: string;
		git?: (command: ShellCommand) => ReturnType<typeof output> | null;
	} = {},
): Promise<{ harness: TestContainer; workspace: Workspace }> {
	const harness = createTestContainer();
	test = harness;
	const repo = await seedRepo(harness.container, {
		rootPath: ROOT,
		remoteUrl: "git@github.com:o/r.git",
	});
	const loaded = await harness.container.services.repo.loadConfig(repo.id);
	if (!loaded.ok) throw new Error(loaded.error.message);
	const workspace = await seedWorkspace(harness.container, {
		repoId: repo.id,
		path: "/code/workspaces/pr-08-panel",
		branch: "feat-b",
	});
	await seedPullRequest(harness.container, workspace.id, {
		number: 12,
		title: "Use the parser",
		description: null,
	});
	await harness.container.services.workspace.start();
	// Graphite stack support starts off; these tests run as a user who turned it on.
	const graphiteOn = await harness.container.actions.settings.set("graphite_disabled", false);
	if (!graphiteOn.ok) throw new Error(graphiteOn.error.message);
	harness.container.services.git.store.setState({
		byWorkspace: {
			[workspace.id]: {
				snapshot: {
					depth: "full",
					branch: "feat-b",
					mergeBase: "abc123",
					mergeBaseError: null,
					files: [],
					conflictedPaths: [],
					untrackedTruncated: false,
					uncommittedFiles: 0,
					changedFiles: 1,
					operation: "none",
					commits: [],
					sync: options.sync ?? { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
					behindTarget: 0,
				},
				error: null,
				refreshedAt: 1,
			},
		},
	});
	harness.container.services.github.store.setState({
		byWorkspace: { [workspace.id]: { pullRequest, unavailable: "none", fetchedAt: 1 } },
	});
	harness.memory.controls.scriptShell((command) => {
		const answer = options.git?.(command);
		if (answer !== null && answer !== undefined) return answer;
		if (command.program === "gt" && command.args[0] === "--version") return output("gt 1.0.0\n");
		if (command.program === "gt" && command.args[0] === "state") {
			return output(options.graphiteState ?? "{}");
		}
		if (command.program === "git" && command.args.includes("get-url")) {
			return output("git@github.com:o/r.git\n");
		}
		if (command.program === "git" && command.args.includes("--git-common-dir")) {
			return output(`${ROOT}/.git\n`);
		}
		if (command.program === "gh" && command.args.includes("graphql")) {
			if (command.args.some((arg) => arg.includes("stackEntry"))) {
				return output(options.stacked === false ? notStackedAnswer : stackAnswer);
			}
			if (command.args.some((arg) => arg.includes("mergeStateStatus"))) {
				return output(readinessAnswer(lowerState, "CLEAN"));
			}
			if (command.args.some((arg) => arg.includes("squashMergeAllowed"))) {
				return output("[true,false,false]\n");
			}
		}
		if (command.program === "gh" && command.args[1]?.includes("/stacks/5") === true) {
			return output(membersAnswer);
		}
		if (command.program === "gh" && command.args[0] === "stack" && command.args[1] === "sync") {
			return options.stackSync ?? output("✓ Stack synced\n");
		}
		return output();
	});
	return { harness, workspace };
}

/** Mounts the panel under the root dispatcher, the way the workspace screen does. */
async function renderPanel(harness: TestContainer, workspace: Workspace): Promise<void> {
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
		<ServicesProvider container={harness.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
}

const stateReads = (harness: TestContainer) =>
	harness.memory.controls.shellCalls.filter(
		(command) => command.program === "gt" && command.args[0] === "state",
	);

describe("PR-08 Graphite poll in the git panel", () => {
	it("runs no gt command while Graphite stack support is at its default", async () => {
		const harness = createTestContainer();
		test = harness;

		await harness.container.services.graphite.refresh(ROOT);

		expect(
			harness.memory.controls.shellCalls.filter((command) => command.program === "gt"),
		).toEqual([]);
	});

	it("polls the shown workspace's repository and releases the poll on unmount", async () => {
		const { harness, workspace } = await seedPanel();

		await renderPanel(harness, workspace);

		await waitFor(() => expect(stateReads(harness)).toHaveLength(1));
		expect(stateReads(harness)[0]?.cwd).toBe(ROOT);

		cleanup();
		// With the panel's poll released, a new watcher starts its own first read at once. A poll
		// still held by the unmounted panel would only add to its count and read nothing.
		const stop = harness.container.services.graphite.watch(ROOT);
		await waitFor(() => expect(stateReads(harness)).toHaveLength(2));
		stop();
	});
});

describe("PR-08 Graphite stack in the Changes tab", () => {
	const graphiteState = JSON.stringify({
		main: { trunk: true },
		"feat-a": { parents: [{ ref: "main", sha: "m0" }] },
		"feat-b": { needs_restack: true, parents: [{ ref: "feat-a", sha: "a1" }] },
		"feat-c": { parents: [{ ref: "feat-b", sha: "b1" }] },
		other: { parents: [{ ref: "main", sha: "m0" }] },
	});
	/** The branch's changes: one file against the merge base with the trunk. */
	const changes = (command: ShellCommand) => {
		if (command.program !== "git") return null;
		if (command.args.includes("merge-base")) return output(`${"1".repeat(40)}\n`);
		if (command.args.includes("--name-status")) return output("M\tsrc/stacked.ts\n");
		if (command.args.includes("--numstat")) return output("2\t1\tsrc/stacked.ts\n");
		return null;
	};
	const stackMembersRead = (harness: TestContainer) =>
		harness.memory.controls.shellCalls.some(
			(command) => command.program === "gh" && command.args[1]?.includes("/stacks/5") === true,
		);

	it("lists the branch's Graphite stack in place of the GitHub one and checks out with gt", async () => {
		const { harness, workspace } = await seedPanel("CLEAN", { graphiteState, git: changes });
		await renderPanel(harness, workspace);

		const names = async () =>
			(await screen.findAllByTestId("graphite-branch")).map((row) => row.dataset.branch);
		expect(await names()).toEqual(["feat-c", "feat-b", "feat-a", "main"]);
		expect(screen.getByLabelText("This branch needs to be restacked. Use gt restack")).toBeTruthy();
		// The checked-out branch shows its own changes under its row.
		const featB = screen
			.getAllByTestId("graphite-branch")
			.find((row) => row.dataset.branch === "feat-b") as HTMLElement;
		expect(await within(featB).findByRole("button", { name: "Open src/stacked.ts" })).toBeTruthy();
		// The GitHub stack is read, and Graphite's list still takes its place.
		await waitFor(() => expect(stackMembersRead(harness)).toBe(true));
		expect(await names()).toHaveLength(4);
		expect(screen.queryByText("Stack PRs")).toBeNull();

		const featA = screen
			.getAllByTestId("graphite-branch")
			.find((row) => row.dataset.branch === "feat-a") as HTMLElement;
		fireEvent.click(within(featA).getByRole("button", { name: "Checkout this branch" }));

		const checkouts = () =>
			harness.memory.controls.shellCalls.filter(
				(command) => command.program === "gt" && command.args[0] === "checkout",
			);
		await waitFor(() =>
			expect(checkouts().map((command) => command.args)).toEqual([["checkout", "feat-a"]]),
		);
		expect(checkouts()[0]?.cwd).toBe("/code/workspaces/pr-08-panel");
	});

	it("heads the panel with the stack's size and no pull request actions in a Graphite stack", async () => {
		const { harness, workspace } = await seedPanel("CLEAN", { graphiteState, git: changes });
		await renderPanel(harness, workspace);

		expect(await screen.findByText("3 branches stacked")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Merge stack/ })).toBeNull();
		expect(screen.queryByText("Ready to merge")).toBeNull();
	});

	it("leaves Cmd+Shift+L alone in a Graphite stack, and pulls outside one", async () => {
		const { harness, workspace } = await seedPanel("CLEAN", { graphiteState, git: changes });
		const pull = vi
			.spyOn(harness.container.services.git, "pull")
			.mockResolvedValue(ok("up_to_date"));
		await renderPanel(harness, workspace);
		await screen.findByText("3 branches stacked");

		fireEvent.keyDown(document.body, { key: "l", metaKey: true, shiftKey: true });
		expect(pull).not.toHaveBeenCalled();

		await harness.container.actions.settings.set("graphite_disabled", true);
		await waitFor(() => expect(screen.queryByText("3 branches stacked")).toBeNull());
		fireEvent.keyDown(document.body, { key: "l", metaKey: true, shiftKey: true });
		await waitFor(() => expect(pull).toHaveBeenCalledWith(workspace.id));
	});

	it("keeps the GitHub stack when Graphite has no stack for the branch", async () => {
		const { harness, workspace } = await seedPanel();
		await renderPanel(harness, workspace);

		expect(await screen.findByText("Stack PRs")).toBeTruthy();
		await waitFor(() => expect(stateReads(harness).length).toBeGreaterThan(0));
		expect(screen.queryAllByTestId("graphite-branch")).toHaveLength(0);
	});

	it("shows no Graphite stack while Graphite stack support is off", async () => {
		const { harness, workspace } = await seedPanel("CLEAN", { graphiteState });
		await harness.container.services.graphite.refresh(ROOT);
		const off = await harness.container.actions.settings.set("graphite_disabled", true);
		if (!off.ok) throw new Error(off.error.message);
		await renderPanel(harness, workspace);

		expect(await screen.findByText("Stack PRs")).toBeTruthy();
		expect(screen.queryAllByTestId("graphite-branch")).toHaveLength(0);
	});
});

describe("PR-08 Merge stack in the git panel", () => {
	it("runs gh stack merge from the header's Merge stack", async () => {
		const { harness, workspace } = await seedPanel();
		await renderPanel(harness, workspace);

		fireEvent.click(await screen.findByRole("button", { name: /Merge stack/ }));

		const merges = () =>
			harness.memory.controls.shellCalls
				.filter((command) => command.program === "gh" && command.args[0] === "stack")
				.map((command) => command.args);
		await waitFor(() => expect(merges()).toEqual([["stack", "merge", "12", "--yes", "--squash"]]));
		const singleMerges = harness.memory.controls.shellCalls.filter(
			(command) =>
				command.program === "gh" && command.args[0] === "pr" && command.args[1] === "merge",
		);
		expect(singleMerges).toHaveLength(0);
	});

	it("says how many pull requests the stack merge takes", async () => {
		const { harness, workspace } = await seedPanel();
		await renderPanel(harness, workspace);

		const button = await screen.findByRole("button", { name: /Merge stack/ });
		expect(button.textContent).toContain("2");
		fireEvent.focus(button);
		expect((await screen.findAllByText("Merge 2 PRs from bottom to top")).length).toBeGreaterThan(
			0,
		);
	});

	it("names the lower pull request that keeps the stack from merging", async () => {
		const { harness, workspace } = await seedPanel("BLOCKED");
		await renderPanel(harness, workspace);

		expect((await screen.findAllByText("#11 isn't ready to merge")).length).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: /Merge/ })).toBeNull();
	});
});

describe("PR-08 Resolve on a stacked branch incompatible with its remote", () => {
	const diverged: BranchSync = { ahead: 1, behind: 2, rewritten: false, hasUpstream: true };

	/** Records what the agent is asked, at the seam between the git panel's services and a chat. */
	const recordAgent = (harness: TestContainer): string[] => {
		const sent: string[] = [];
		// seam: PR-08 the chat is the agent's door; the test reads what reaches it, not a reply.
		vi.spyOn(harness.container.services.sessions, "sendInstruction").mockImplementation(
			async (_workspaceId, text) => {
				sent.push(text);
				return ok("session-1" as SessionId);
			},
		);
		return sent;
	};

	const stackSyncs = (harness: TestContainer) =>
		harness.memory.controls.shellCalls.filter(
			(command) =>
				command.program === "gh" && command.args[0] === "stack" && command.args[1] === "sync",
		);

	it("runs gh stack sync and asks the agent nothing when the sync succeeds", async () => {
		const { harness, workspace } = await seedPanel("CLEAN", { sync: diverged });
		const sent = recordAgent(harness);
		await renderPanel(harness, workspace);
		// The stack has been read once the stack view lists its lower pull request.
		await screen.findByText(/Add the parser/);

		fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));

		await waitFor(() => expect(stackSyncs(harness)).toHaveLength(1));
		expect(stackSyncs(harness)[0]?.cwd).toBe("/code/workspaces/pr-08-panel");
		// The sync's pending state clears when it has finished, so any fallback would be sent by now.
		await waitFor(() =>
			expect(
				harness.container.services.github.store.getState().pendingActions[workspace.id],
			).toBeUndefined(),
		);
		expect(sent).toEqual([]);
	});

	it("asks the agent to resolve the incompatibility when the stack sync fails", async () => {
		const { harness, workspace } = await seedPanel("CLEAN", {
			sync: diverged,
			stackSync: output("", 'unknown command "stack" for "gh"\n', 1),
		});
		const sent = recordAgent(harness);
		await renderPanel(harness, workspace);
		await screen.findByText(/Add the parser/);

		fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));

		await waitFor(() => expect(sent).toEqual(["Resolve branch incompatibility with remote"]));
		expect(stackSyncs(harness)).toHaveLength(1);
	});

	it("asks the agent at once when the pull request is not in a stack", async () => {
		const { harness, workspace } = await seedPanel("CLEAN", { sync: diverged, stacked: false });
		const sent = recordAgent(harness);
		await renderPanel(harness, workspace);

		fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));

		await waitFor(() => expect(sent).toEqual(["Resolve branch incompatibility with remote"]));
		expect(stackSyncs(harness)).toHaveLength(0);
	});
});
