/**
 * @feature s1-core Join the batch's features through the composition root
 * Owns: one test per feature of the batch (CHAT-04, GIT-17, PR-05 and REV-12), each driven through
 * createTestContainer with the real service and the real screen that shows it.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container wiring or screen mount is removed.
 */
import { idleLiveState, type SessionConfig } from "@conducted/protocol";
import { ok, type Result, type SessionId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { CommandDispatcher } from "../app/command-dispatcher.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { ChatPane } from "../features/chat/ChatPane.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { GitPanel } from "../features/git-panel/GitPanel.tsx";
import type { ShellCommand, ShellOutput } from "../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { createRepositories } from "./db/repositories.ts";
import type { CheckRun, PullRequest, Workspace } from "./model.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const output = (stdout = "", stderr = "", exitCode = 0): Result<ShellOutput> =>
	ok({ stdout, stderr, exitCode });

type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;

const Services = ServicesProvider as unknown as LooseComponent;
const App = AppProviders as unknown as LooseComponent;
const Dispatcher = CommandDispatcher as unknown as LooseComponent;
const Virtuoso = VirtuosoMockContext.Provider as unknown as LooseComponent;

/** The git arguments without the runner's `-c core.quotePath=false` prefix. */
const argv = (command: ShellCommand): readonly string[] =>
	command.program === "git" && command.args[0] === "-c" ? command.args.slice(2) : command.args;

const check = (state: CheckRun["state"]): CheckRun => ({
	name: "build",
	state,
	url: null,
	startedAt: null,
	completedAt: null,
	required: true,
});

const pullRequest = (overrides: Partial<PullRequest> = {}): PullRequest => ({
	number: 12,
	url: "https://github.com/me/project/pull/12",
	title: "A change",
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
	...overrides,
});

/** Runs a screen the way the workspace screen does: the real container, the root dispatcher and the router. */
async function mount(test: TestContainer, screen: ReactNode): Promise<void> {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => screen,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		createElement(
			Services,
			{ container: test.container },
			createElement(
				App,
				{ client: createQueryClient(() => {}) },
				createElement(
					Dispatcher,
					null,
					createElement(
						Virtuoso,
						{ value: { viewportHeight: 800, itemHeight: 200 } },
						createElement(RouterProvider, { router }),
					),
				),
			),
		),
	);
	await router.load();
}

/** Puts a loaded git state and the given pull request in the stores the panel reads. */
function showGitState(
	test: TestContainer,
	workspace: Workspace,
	options: { branch: string; pullRequest: PullRequest | null },
): void {
	test.container.services.git.store.setState({
		byWorkspace: {
			[workspace.id]: {
				snapshot: {
					depth: "full",
					branch: options.branch,
					mergeBase: "abc123",
					mergeBaseError: null,
					files: [],
					conflictedPaths: [],
					untrackedTruncated: false,
					uncommittedFiles: 0,
					changedFiles: 1,
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
	test.container.services.github.store.setState({
		byWorkspace: {
			[workspace.id]: {
				pullRequest: options.pullRequest,
				unavailable: "none",
				fetchedAt: 1,
			},
		},
	});
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("s1-core join", () => {
	it("CHAT-04 queues a follow-up through the chat pane and deletes it there", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.start());
			must(
				await test.container.services.sessions.applyLiveState(session.id, {
					...idleLiveState,
					status: "working",
				}),
			);

			must(await test.container.actions.sessions.send(session.id, "first follow-up", [], "queue"));
			must(await test.container.actions.sessions.send(session.id, "second follow-up", [], "queue"));

			await mount(
				test,
				createElement(ChatPane, { workspaceId: workspace.id, sessionId: session.id }),
			);

			const box = await screen.findByRole("listbox", { name: "Queued messages" });
			expect(within(box).getByText("first follow-up")).toBeTruthy();
			expect(within(box).getAllByRole("option")).toHaveLength(2);

			const first = within(box).getAllByRole("option")[0];
			if (first === undefined) throw new Error("The queue has no first row.");
			fireEvent.click(within(first).getByRole("button", { name: "Delete" }));

			await waitFor(() =>
				expect(
					test.container.services.followUpQueue.store
						.getState()
						.bySession[session.id]?.map((row) => row.text),
				).toEqual(["second follow-up"]),
			);
			expect(within(box).queryByText("first follow-up")).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("GIT-17 continues on a new branch from the git panel after a merge", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container, { rootPath: "/code/projects/s1-core-git-17" });
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/s1-core-git-17",
				branch: "feat",
				targetBranch: "origin/main",
			});
			const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			showGitState(test, workspace, {
				branch: "feat",
				pullRequest: pullRequest({ state: "merged" }),
			});

			test.memory.controls.scriptShell((command) => {
				const args = argv(command);
				if (args[0] === "branch" && args[1] === "--show-current") return output("feat\n");
				if (args[0] === "fetch") return output();
				if (args[0] === "rev-parse" && args[1] === "refs/remotes/origin/main") {
					return output("target-sha\n");
				}
				if (args[0] === "show-ref") {
					const ref = args[args.length - 1] ?? "";
					return ref.endsWith("/feat") ? output("sha refs/heads/feat\n") : output("", "", 1);
				}
				if (args[0] === "remote" && args[1] === "get-url") {
					return output("git@example.com:acme/app.git\n");
				}
				if (args[0] === "checkout" && args[1] === "-b") return output();
				return null;
			});
			const sent: string[] = [];
			vi.spyOn(test.container.services.sessions, "sendInstruction").mockImplementation(
				async (_workspaceId, text) => {
					sent.push(text);
					return ok(chat.id);
				},
			);

			await mount(test, createElement(GitPanel, { workspaceId: workspace.id }));
			fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));

			await waitFor(() =>
				expect(
					test.container.services.workspace.store.getState().workspacesById[workspace.id]?.branch,
				).toBe("feat-v2"),
			);
			expect(
				test.memory.controls.files.get(
					"/code/workspaces/s1-core-git-17/.context/Branch continued.md",
				),
			).toContain("feat-v2");
			expect(sent[0]).toContain("feat-v2");
			expect(test.container.services.sessions.store.getState().sessions[chat.id]).toBeDefined();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("PR-05 sends the failing checks to the agent from Cmd+Shift+X", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id, branch: "feat" });
			must(await test.container.services.repo.loadConfig(repo.id));
			showGitState(test, workspace, {
				branch: "feat",
				pullRequest: pullRequest({ checks: [check("failure")] }),
			});
			const sent: { workspaceId: Workspace["id"]; text: string }[] = [];
			vi.spyOn(test.container.services.sessions, "sendInstruction").mockImplementation(
				async (workspaceId, text) => {
					sent.push({ workspaceId, text });
					return ok("test-session" as SessionId);
				},
			);

			await mount(test, createElement(GitPanel, { workspaceId: workspace.id }));
			await screen.findByRole("button", { name: /Fix errors/ });

			fireEvent.keyDown(document.body, { key: "x", metaKey: true, shiftKey: true });

			await waitFor(() => expect(sent).toHaveLength(1));
			expect(sent[0]?.workspaceId).toBe(workspace.id);
			expect(sent[0]?.text).toContain("Fix the failing checks");
			expect(sent[0]?.text).toContain("build");
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("REV-12 moves review comment states and links an attachment to the comment it carried", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const actions = test.container.actions.comments;
			const first = must(await actions.add(workspace.id, "src/a.ts", 1, null, "First"));
			const second = must(await actions.add(workspace.id, "src/b.ts", 2, null, "Second"));

			must(await actions.markAllReady(workspace.id));
			expect(
				test.container.services.review.store
					.getState()
					.byWorkspace[workspace.id]?.map((comment) => comment.state),
			).toEqual(["ready_for_review", "ready_for_review"]);

			must(await actions.setHidden(first.id, true));
			expect(
				test.container.services.review.store.getState().byWorkspace[workspace.id]?.[0]?.state,
			).toBe("hidden");
			must(await actions.setHidden(first.id, false));
			expect(
				test.container.services.review.store.getState().byWorkspace[workspace.id]?.[0]?.state,
			).toBe("pending");

			const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			vi.spyOn(test.container.services.sessions, "sendInstruction").mockResolvedValue(ok(chat.id));
			must(await actions.sendToChat(workspace.id, [first.id, second.id]));
			expect(
				test.container.services.review.store
					.getState()
					.byWorkspace[workspace.id]?.map((comment) => comment.state),
			).toEqual(["reviewed", "reviewed"]);

			// sendToChat recorded which chat received each comment.
			const repositories = createRepositories(test.database, {
				clock: { now: () => 1_000 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			const attachment = expect.objectContaining({
				sessionId: chat.id,
				kind: "review",
				originalName: `${encodeURIComponent(first.id)}.md`,
				isDraft: false,
				commentId: first.id,
			});

			expect(await repositories.attachments.listByComment(first.id)).toEqual(ok([attachment]));
			expect(await repositories.attachments.listByComment(second.id)).toEqual(
				ok([expect.objectContaining({ sessionId: chat.id, commentId: second.id })]),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
