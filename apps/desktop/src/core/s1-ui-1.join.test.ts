/**
 * @feature s1-ui-1 Join the batch's features through the composition root
 * Owns: one test per feature in the batch, each reached through createTestContainer and the real
 * service, screen or route the app mounts.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container wiring or mount is removed.
 */
import type { CanonicalTool, SessionConfig, SessionEvent } from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import {
	type EventId,
	type InteractionId,
	ok,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { createElement, type ReactNode } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { useOverlayStore } from "../app/overlay-store.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { createAppRouter } from "../app/router.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { ChatPane } from "../features/chat/ChatPane.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { ToolCard } from "../features/chat/tools/ToolCard.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { Composer } from "../features/composer/Composer.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { GitPanel } from "../features/git-panel/GitPanel.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { TabContent } from "../features/workspace/TabContent.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import type { PullRequest, ToolCallView } from "./model.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

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

type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;

const Services = ServicesProvider as unknown as LooseComponent;
const Virtuoso = VirtuosoMockContext.Provider as unknown as LooseComponent;
const App = AppProviders as unknown as LooseComponent;
const Queries = QueryClientProvider as unknown as LooseComponent;

const withServices = (test: TestContainer, child: ReactNode) =>
	createElement(Services, { container: test.container }, child);

let nextTool = 0;

function toolView(tool: CanonicalTool, input: unknown, output?: string): ToolCallView {
	nextTool += 1;
	const toolUseId = `join-tool-${nextTool}` as ToolCallView["toolUseId"];
	return {
		toolUseId,
		item: { kind: "tool_call", toolUseId, tool, rawName: tool, input },
		result:
			output === undefined
				? null
				: { kind: "tool_result", toolUseId, output, isError: false, truncated: false },
		children: [],
	};
}

type AgentEvent = Extract<SessionEvent, { type: "agent" }>;
type UsageItem = Extract<AgentEvent["message"]["items"][number], { kind: "usage" }>;

let nextEvent = 0;

function usageEvent(over: Partial<UsageItem> = {}): SessionEvent {
	nextEvent += 1;
	return {
		eventId: `join-event-${nextEvent}` as EventId,
		at: nextEvent,
		type: "agent",
		turnId: "turn-1" as TurnId,
		message: {
			agent: "claude",
			items: [
				{
					kind: "usage",
					inputTokens: 1200,
					outputTokens: 300,
					cacheReadTokens: 4000,
					cacheWriteTokens: 500,
					costUsd: 0.0123,
					contextUsedTokens: 72_000,
					contextWindowTokens: 100_000,
					model: "claude-sonnet-4-5",
					fastMode: false,
					serviceTier: "standard",
					...over,
				},
			],
		},
	};
}

async function mountChatPane(
	test: TestContainer,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
): Promise<void> {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => createElement(ChatPane, { workspaceId, sessionId }),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		withServices(
			test,
			createElement(
				Virtuoso,
				{ value: { viewportHeight: 800, itemHeight: 200 } },
				createElement(RouterProvider, { router }),
			),
		),
	);
	await router.load();
}

const pullRequest: PullRequest = {
	number: 12,
	url: "https://github.com/o/r/pull/12",
	title: "Add the checks tab",
	body: "",
	state: "open",
	mergeable: "unknown",
	reviewDecision: null,
	checks: [
		{
			name: "Build",
			state: "failure",
			url: "https://github.com/o/r/actions/runs/9/job/7",
			startedAt: null,
			completedAt: null,
			required: true,
		},
	],
	inMergeQueue: false,
	autoMergeEnabled: false,
	baseBranch: "main",
	authorLogin: "octocat",
	viewerDidAuthor: false,
	viewerCanMerge: true,
	mergeMethod: "squash",
	reviewers: [],
	deployments: [],
	updatedAt: 0,
};

const gitSnapshot = {
	depth: "full" as const,
	branch: "feat/checks",
	mergeBase: null,
	mergeBaseError: null,
	files: [],
	conflictedPaths: [],
	untrackedTruncated: false,
	uncommittedFiles: 0,
	changedFiles: 0,
	operation: "none" as const,
	commits: [],
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
	behindTarget: 0,
};

afterEach(() => {
	cleanup();
	useOverlayStore.getState().close();
	vi.restoreAllMocks();
});

describe("s1-ui-1 join", () => {
	it("CHAT-12 approves a plan through the chat pane's interaction dock", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.start());
			must(
				await test.container.services.sessions.applyLiveState(created.id, {
					...idleLiveState,
					openInteraction: {
						interactionId: "join-plan" as InteractionId,
						interaction: {
							kind: "plan_approval",
							plan: "First, change the parser.\nThen run the tests.",
						},
						since: 1,
					},
				}),
			);
			const answer = vi
				.spyOn(test.container.services.sessions, "answer")
				.mockResolvedValue(ok(undefined));

			await mountChatPane(test, workspace.id, created.id);

			expect(await screen.findByRole("group", { name: "Plan review" })).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Approve" }));

			await waitFor(() =>
				expect(answer).toHaveBeenCalledWith(created.id, "join-plan", {
					kind: "plan_approval",
					approved: true,
				}),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("CHAT-14 shows the context wheel in the composer for the chat's usage", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			test.container.services.sessions.applyStoredEvent(created.id, 1, usageEvent(), 1001);

			render(
				withServices(
					test,
					createElement(Composer, {
						workspaceId: workspace.id,
						sessionId: created.id,
					}),
				),
			);

			expect(await screen.findByRole("button", { name: "Context usage: 72%" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("CHAT-20 shows the new tool cards through the tool card registry", async () => {
		const test = createTestContainer();
		try {
			const sessionId = "join-tool-session" as SessionId;
			const cases: { tool: CanonicalTool; input: unknown; output?: string; title: string }[] = [
				{ tool: "task_list", input: {}, output: "[]", title: "No tasks" },
				{
					tool: "task_get",
					input: { taskId: "1" },
					output: "Task #1: Write the test\nStatus: pending",
					title: "Task details",
				},
				{ tool: "task_create", input: { subject: "Write the test" }, title: "Task created" },
				{ tool: "task_update", input: { taskId: "1" }, title: "Task details" },
				{ tool: "task_stop", input: { taskId: "1" }, title: "Stop task" },
				{ tool: "monitor", input: { command: "npm run dev" }, title: "Start monitor" },
				{ tool: "node_repl", input: { code: "1 + 1" }, title: "Node REPL" },
				{ tool: "image_view", input: { path: "/tmp/plot.png" }, title: "Preview image" },
				{ tool: "image_generation", input: { prompt: "a cat" }, title: "Loading image" },
				{ tool: "tool_search", input: { query: "task" }, title: "Search tools" },
				{ tool: "schedule_wakeup", input: { delaySeconds: 60 }, title: "Schedule wakeup" },
				{ tool: "send_message", input: { message: "hello" }, title: "Send message" },
			];

			for (const entry of cases) {
				render(
					withServices(
						test,
						createElement(ToolCard, {
							call: toolView(entry.tool, entry.input, entry.output),
							sessionId,
						}),
					),
				);
				expect(await screen.findByText(entry.title)).toBeTruthy();
				cleanup();
			}
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-04 attaches the terminal output from the composer's @ menu", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			// seam: COMP-04 reads the screen through RUN-07's outputFor; PLAT-08 saves no screen yet.
			const outputFor = vi
				.spyOn(test.container.services.terminals, "outputFor")
				.mockResolvedValue(ok({ output: "build finished\n", source: "Terminal", running: false }));
			let editor: Editor | null = null;

			render(
				withServices(
					test,
					createElement(Composer, {
						workspaceId: workspace.id,
						sessionId: created.id,
						onEditorReady: (ready: Editor | null) => {
							editor = ready;
						},
					}),
				),
			);
			await waitFor(() => expect(editor).not.toBeNull());
			act(() => {
				(editor as unknown as Editor).commands.insertContent("@");
			});

			fireEvent.click(await screen.findByText("Attach current terminal output"));

			await waitFor(() => expect(outputFor).toHaveBeenCalledWith(workspace.id, "auto", 1_000));
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-06 sends a slash command picked from the composer's / menu", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const send = vi
				.spyOn(test.container.services.sessions, "send")
				.mockResolvedValue(ok(undefined));
			let editor: Editor | null = null;

			render(
				withServices(
					test,
					createElement(Composer, {
						workspaceId: workspace.id,
						sessionId: created.id,
						onEditorReady: (ready: Editor | null) => {
							editor = ready;
						},
					}),
				),
			);
			await waitFor(() => expect(editor).not.toBeNull());
			act(() => {
				(editor as unknown as Editor).commands.insertContent("/co");
			});

			fireEvent.click(await screen.findByText("/compact"));

			await waitFor(() => expect(send).toHaveBeenCalledWith(created.id, "/compact", [], "auto"));
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("NAV-08 opens the command palette from Cmd+K at the app root", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
			render(
				withServices(
					test,
					createElement(
						App,
						{ client: createQueryClient(() => {}) },
						createElement(RouterProvider, { router }),
					),
				),
			);
			await router.load();

			fireEvent.keyDown(document, { key: "k", metaKey: true });

			expect(await screen.findByPlaceholderText("Type a command or search...")).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("PR-04 opens the checks tab from the git panel and re-runs a failed check", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			test.container.services.git.store.setState((state) => ({
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspace.id]: { snapshot: gitSnapshot, error: null, refreshedAt: 1 },
				},
			}));
			test.container.services.github.store.setState((state) => ({
				...state,
				byWorkspace: {
					...state.byWorkspace,
					[workspace.id]: { pullRequest, unavailable: "none", fetchedAt: 1 },
				},
			}));
			const rerun = vi
				.spyOn(test.container.actions.pullRequests, "rerunFailedChecks")
				.mockResolvedValue(ok(undefined));
			const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

			render(
				withServices(
					test,
					createElement(
						Queries,
						{ client },
						createElement(GitPanel, { workspaceId: workspace.id, tab: "checks" }),
					),
				),
			);

			expect(await screen.findByText("Build")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Re-run failed checks" }));

			await waitFor(() => expect(rerun).toHaveBeenCalledWith(workspace.id));
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("REV-03 removes a review comment through the comment tab", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const added = must(
				await test.container.services.review.add(
					workspace.id,
					"src/a.ts",
					12,
					null,
					"Please rename this",
				),
			);

			render(
				withServices(
					test,
					createElement(TabContent, {
						workspaceId: workspace.id,
						search: { tab: "comment", commentId: added.id },
						onSearchChange: () => {},
					}),
				),
			);

			expect(await screen.findByText("Please rename this")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));

			expect(await screen.findByText("Comment not found")).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
