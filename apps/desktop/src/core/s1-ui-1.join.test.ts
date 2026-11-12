/**
 * @feature s1-ui-1 Join the batch's features through the composition root
 * Owns: one test per feature in the batch, each reached through createTestContainer and the real
 * service, screen or route the app mounts.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container wiring or mount is removed.
 */
import type { CanonicalTool, SessionConfig, SessionEvent, SlashCommand } from "@conducted/protocol";
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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { createElement, Fragment, type ReactNode } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { CommandDispatcher } from "../app/command-dispatcher.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { useOverlayStore } from "../app/overlay-store.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { createAppRouter } from "../app/router.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { ShellControls } from "../app/ShellControls.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { ChatPane } from "../features/chat/ChatPane.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { MessageList } from "../features/chat/MessageList.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { ToolCard } from "../features/chat/tools/ToolCard.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { Composer } from "../features/composer/Composer.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { GitPanel } from "../features/git-panel/GitPanel.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { GeneralPage } from "../features/settings/pages/GeneralPage.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { ResourceUsageTable } from "../features/sidebar/ResourceUsageTable.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { TabContent } from "../features/workspace/TabContent.tsx";
import type { ShellCommand } from "../platform/platform.ts";
import { agentEvent, userMessageEvent } from "../test/chat-events.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import { answerSidecar, sidecarRefuses } from "../test/sidecar-answers.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the toast host the app root mounts
import { Toaster } from "../ui/Toast.tsx";
import { ServicesProvider } from "./context.tsx";
import { createRepositories } from "./db/repositories.ts";
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
const Dispatcher = CommandDispatcher as unknown as LooseComponent;
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
		blocks: [],
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
				Dispatcher,
				{},
				createElement(
					Virtuoso,
					{ value: { viewportHeight: 800, itemHeight: 200 } },
					createElement(RouterProvider, { router }),
				),
			),
		),
	);
	await router.load();
}

/**
 * A chat in plan mode whose agent waits on its plan. Conductor shows the plan bar only then
 * (renderApp @9314918).
 */
async function seedWaitingPlan(
	test: TestContainer,
): Promise<{ workspaceId: WorkspaceId; sessionId: SessionId }> {
	const workspace = await seedWorkspace(test.container);
	const created = must(
		await test.container.services.sessions.create(workspace.id, { ...CONFIG, planMode: true }),
	);
	must(await test.container.services.sessions.start());
	// Approving turns plan mode off through the sidecar, which takes the change.
	must(await test.container.sidecar.start());
	answerSidecar(test, (call) =>
		call.method === "updateConfig"
			? { applied: "live" }
			: sidecarRefuses(`Unexpected ${call.method}`),
	);
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
	return { workspaceId: workspace.id, sessionId: created.id };
}

/**
 * Mounts the real composer and hands back its editor, beside the toast host the app root mounts
 * (AppProviders), so a message the composer toasts reaches the screen as it does in the app.
 */
async function mountComposer(
	test: TestContainer,
	workspaceId: WorkspaceId,
	sessionId: SessionId,
): Promise<Editor> {
	let editor: Editor | null = null;
	render(
		withServices(
			test,
			createElement(
				Fragment,
				null,
				createElement(Composer, {
					workspaceId,
					sessionId,
					onEditorReady: (ready: Editor | null) => {
						editor = ready;
					},
				}),
				createElement(Toaster),
			),
		),
	);
	await waitFor(() => expect(editor).not.toBeNull());
	return editor as unknown as Editor;
}

/**
 * Answers the agent's slash command list with `commands`.
 * seam: COMP-06 the list comes from the sidecar's listSlashCommands, which this container does not run.
 */
function listSlashCommands(test: TestContainer, sessionId: SessionId, commands: SlashCommand[]) {
	const catalog = test.container.services.agentCatalog;
	vi.spyOn(catalog, "loadSlashCommands").mockImplementation(async () => {
		catalog.store.setState((state) => ({
			slashCommands: { ...state.slashCommands, [sessionId]: { state: "ready", data: commands } },
		}));
		return ok(commands);
	});
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
			const { workspaceId, sessionId } = await seedWaitingPlan(test);
			const answer = vi
				.spyOn(test.container.services.sessions, "answer")
				.mockResolvedValue(ok(undefined));

			await mountChatPane(test, workspaceId, sessionId);

			await screen.findByRole("group", { name: "Plan review" });
			// Focus stays in the composer while the plan waits (Chromium on the catalogue state
			// chat-plan-review, issue #586), so the key is pressed there and reaches the app's root
			// dispatcher, as Conductor's chat pane command does.
			fireEvent.keyDown(await screen.findByRole("textbox", { name: "composer" }), {
				key: "Enter",
				// ProseMirror takes every keydown with code 13, as a browser sends Enter.
				keyCode: 13,
				metaKey: true,
				shiftKey: true,
			});

			await waitFor(() =>
				expect(answer).toHaveBeenCalledWith(sessionId, "join-plan", {
					kind: "plan_approval",
					approved: true,
				}),
			);
			expect(await screen.findByText("Approved")).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	// Conductor's Approve button runs the same action as its shortcut: with text in the composer it
	// sends the text as the plan's adjustments, and approves only an empty composer (renderApp
	// @9313268; the bar's onApprovePlan at @9315041). Issue #595. In a chat that is not Codex the
	// action also turns plan mode off and queues the text as a new message (@9313048). Issue #610.
	it("CHAT-12 the plan bar's Approve sends the composer's text as the plan's adjustments", async () => {
		const test = createTestContainer();
		try {
			const { workspaceId, sessionId } = await seedWaitingPlan(test);
			const answer = vi
				.spyOn(test.container.services.sessions, "answer")
				.mockResolvedValue(ok(undefined));
			const send = vi
				.spyOn(test.container.services.sessions, "send")
				.mockResolvedValue(ok(undefined));

			await mountChatPane(test, workspaceId, sessionId);
			const field = await screen.findByRole("textbox", { name: "composer" });
			// TipTap hangs its editor on the element it draws into.
			const editor = (field as unknown as { editor: Editor }).editor;
			act(() => {
				editor.commands.insertContent("Keep the old cache for reads.");
			});
			fireEvent.click(screen.getByRole("button", { name: "Approve" }));

			await waitFor(() =>
				expect(answer).toHaveBeenCalledWith(sessionId, "join-plan", {
					kind: "plan_approval",
					approved: false,
					feedback: "Keep the old cache for reads.",
				}),
			);
			expect(answer).toHaveBeenCalledTimes(1);
			await waitFor(() =>
				expect(send).toHaveBeenCalledWith(sessionId, "Keep the old cache for reads.", [], "queue"),
			);
			expect(
				test.container.services.sessions.store.getState().sessions[sessionId]?.config.planMode,
			).toBe(false);
			await waitFor(() => expect(editor.getText()).toBe(""));
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
			test.container.services.contextWindows.remember("claude", CONFIG.model, 100_000);
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

			expect(await screen.findByRole("button", { name: "Context usage" })).toBeTruthy();
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
				expect((await screen.findAllByText(entry.title)).length).toBeGreaterThan(0);
				cleanup();
			}
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-04 offers the workspace's files in the composer's @ menu and inserts a chip", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			test.memory.controls.files.set(`${workspace.path}/README.md`, "# Read me\n");
			test.memory.controls.files.set(`${workspace.path}/src/app.ts`, "export {};\n");
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("@rea");
			});

			fireEvent.click(await screen.findByText("README.md"));

			await waitFor(() => expect(JSON.stringify(editor.getJSON())).toContain('"path":"README.md"'));
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
			listSlashCommands(test, created.id, [
				{ name: "compact", description: "Compact", source: "builtin", kind: "command" },
			]);
			const send = vi
				.spyOn(test.container.services.sessions, "send")
				.mockResolvedValue(ok(undefined));
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("/co");
			});

			fireEvent.click(await screen.findByText("/compact"));

			await waitFor(() => expect(send).toHaveBeenCalledWith(created.id, "/compact", [], "auto"));
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-06 /restart restarts the agent instead of messaging it", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			listSlashCommands(test, created.id, []);
			// seam: COMP-06 restartAgent resets the agent through the sidecar, which this container does not run.
			const restart = vi
				.spyOn(test.container.services.sessions, "restartAgent")
				.mockResolvedValue(ok(undefined));
			const send = vi.spyOn(test.container.services.sessions, "send");
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("/resta");
			});

			fireEvent.click(await screen.findByText("/restart"));

			await waitFor(() => expect(restart).toHaveBeenCalledWith(created.id));
			expect(send).not.toHaveBeenCalled();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-06 /plan turns plan mode on through the toolbar's own toggle", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			listSlashCommands(test, created.id, []);
			const send = vi.spyOn(test.container.services.sessions, "send");
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("/pla");
			});

			fireEvent.click(await screen.findByText("/plan"));

			await waitFor(() =>
				expect(
					test.container.services.sessions.store.getState().sessions[created.id]?.config.planMode,
				).toBe(true),
			);
			expect(send).not.toHaveBeenCalled();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-06 says a built-in the app cannot run here is not available", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			listSlashCommands(test, created.id, []);
			const send = vi.spyOn(test.container.services.sessions, "send");
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("/comp");
			});

			fireEvent.click(await screen.findByText("/compact"));

			expect(
				await screen.findByText("This command isn't available in this workspace."),
			).toBeTruthy();
			expect(send).not.toHaveBeenCalled();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-06 runs /hooks in a terminal and follows it until Done restarts the agent", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const repositories = createRepositories(test.container.platform.db, {
				clock: { now: () => 1 },
				ids: { uuid: () => crypto.randomUUID() },
			});
			must(await repositories.workspaces.transitionState(workspace.id, "initializing", "ready"));
			must(await test.container.platform.fs.mkdirp(workspace.path));
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			listSlashCommands(test, created.id, []);
			// seam: COMP-06 restartAgent resets the agent through the sidecar, which this container does not run.
			const restart = vi
				.spyOn(test.container.services.sessions, "restartAgent")
				.mockResolvedValue(ok(undefined));
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("/hoo");
			});

			fireEvent.click(await screen.findByText("/hooks"));

			expect(await screen.findByText("Complete /hooks below, then click done")).toBeTruthy();
			const terminals =
				test.container.services.terminals.store.getState().byWorkspace[workspace.id];
			const terminal = terminals?.find((entry) => entry.startCommand === "claude /hooks; exit");
			expect(terminal).toBeDefined();

			// The shell exits with the command's own code when the agent program ends.
			act(() => {
				test.container.services.terminals.store.setState((state) => ({
					byWorkspace: {
						...state.byWorkspace,
						[workspace.id]: (state.byWorkspace[workspace.id] ?? []).map((entry) =>
							entry.id === terminal?.id ? { ...entry, endedAt: 2, exitCode: 1 } : entry,
						),
					},
				}));
			});
			expect(
				await screen.findByText(
					"Terminal command finished. Refresh to use the updated config here",
				),
			).toBeTruthy();
			expect(screen.getByText("The command exited with code 1.")).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Done" }));

			await waitFor(() => expect(restart).toHaveBeenCalledWith(created.id));
			expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-06 offers to reopen the terminal when it could not start", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			listSlashCommands(test, created.id, []);
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("/mem");
			});

			fireEvent.click(await screen.findByText("/memory"));

			// The seeded workspace is still being set up, so the terminal service refuses it.
			expect(await screen.findByText("Run /memory in the embedded terminal")).toBeTruthy();
			expect(screen.getByText("Workspace is not ready for local terminals.")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Reopen terminal" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("COMP-06 says so in the menu when the agent's commands cannot be loaded", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const editor = await mountComposer(test, workspace.id, created.id);
			act(() => {
				editor.commands.insertContent("/");
			});

			// The test container runs no sidecar, so the real list request fails.
			expect(await screen.findByText(/^Couldn't load this agent's commands: /)).toBeTruthy();
			expect(screen.getByText("/restart")).toBeTruthy();
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
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			must(await test.container.services.repo.loadConfig(repo.id));
			test.container.services.workspace.store.setState((state) => ({
				workspacesById: {
					...state.workspacesById,
					[workspace.id]: { ...workspace, prNumber: 12 },
				},
			}));
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
			// The real action runs `gh` through the in-memory shell; only the re-run is answered.
			const reruns: ShellCommand[] = [];
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "gh" || command.args[0] !== "run") return null;
				reruns.push(command);
				return ok({ stdout: "", stderr: "", exitCode: 0 });
			});
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
			fireEvent.click(screen.getByRole("button", { name: "Re-run" }));

			await waitFor(() =>
				expect(reruns.map((command) => [...command.args])).toEqual([
					["run", "rerun", "9", "--failed"],
				]),
			);
			expect(reruns[0]?.cwd).toBe(workspace.path);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("REV-03 stores the agent's diff comments with the chat's model as author", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.sidecar.start());
			const workspace = await seedWorkspace(test.container);
			const created = must(
				await test.container.services.sessions.create(workspace.id, {
					...CONFIG,
					model: "claude-sonnet-4-5",
				}),
			);

			// The sidecar relays the agent's DiffComment tool call to the app.
			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					id: "agent-comment-1",
					method: "addDiffComments",
					params: {
						sessionId: created.id,
						comments: [{ file: "src/a.ts", line: 4, body: "This can be null." }],
					},
				}),
			);

			await waitFor(() =>
				expect(
					(test.container.services.review.store.getState().byWorkspace[workspace.id] ?? []).map(
						(comment) => [comment.author.kind, comment.author.name, comment.body],
					),
				).toEqual([["agent", "claude-sonnet-4-5", "This can be null."]]),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("REV-03 moves between comments with Cmd+Alt+J and Cmd+Alt+K in the comment tab", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const review = test.container.services.review;
			const first = must(await review.add(workspace.id, "src/a.ts", 3, null, "First note"));
			const second = must(await review.add(workspace.id, "src/a.ts", 9, null, "Second note"));
			const onSearchChange = vi.fn();

			render(
				withServices(
					test,
					createElement(
						Dispatcher,
						{},
						createElement(TabContent, {
							workspaceId: workspace.id,
							search: { tab: "comment", commentId: first.id },
							onSearchChange,
						}),
					),
				),
			);

			const body = await screen.findByText("First note");
			fireEvent.keyDown(body, { key: "j", metaKey: true, altKey: true });
			await waitFor(() =>
				expect(onSearchChange).toHaveBeenCalledWith({ tab: "comment", commentId: second.id }),
			);

			fireEvent.keyDown(body, { key: "k", metaKey: true, altKey: true });
			// Going back from the first comment wraps around to the last one.
			await waitFor(() => expect(onSearchChange).toHaveBeenCalledTimes(2));
			expect(onSearchChange).toHaveBeenLastCalledWith({ tab: "comment", commentId: second.id });
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

const batchOpen: TestContainer[] = [];

function batchContainer(): TestContainer {
	const test = createTestContainer();
	batchOpen.push(test);
	return test;
}

async function renderBatchUi(test: TestContainer, ui: ReactNode) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => ui,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		createElement(
			App,
			{ client: createQueryClient(() => {}) },
			withServices(
				test,
				createElement(
					Virtuoso,
					{ value: { viewportHeight: 800, itemHeight: 200 } },
					createElement(RouterProvider, { router }),
				),
			),
		),
	);
	await router.load();
	return router;
}

async function readyBatchWorkspace(test: TestContainer, path?: string) {
	const workspace = await seedWorkspace(test.container, path === undefined ? {} : { path });
	await test.container.platform.fs.mkdirp(workspace.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	must(await test.container.services.workspace.start());
	return workspace;
}

async function batchChat(
	test: TestContainer,
	workspaceId: WorkspaceId,
	events: readonly SessionEvent[],
	config: SessionConfig = CONFIG,
) {
	const session = must(await test.container.services.sessions.create(workspaceId, config));
	must(await test.container.services.sessions.start());
	for (const [idx, event] of events.entries()) {
		test.container.services.sessions.applyStoredEvent(session.id, idx, event, event.at);
	}
	return session;
}

const BATCH_ENVIRONMENT = [
	"LANG=en_AU.UTF-8",
	"API_TOKEN=super-secret",
	"HOME=/Users/conducted",
	"PATH=/Users/conducted/bin:/usr/bin:/bin",
].join("\n");

describe("s1-ui-1 join batch features", () => {
	afterEach(async () => {
		for (const test of batchOpen.splice(0)) {
			await test.container.stop();
			test.close();
		}
	});

	it("APP-03 opens the diagnostics route and shows the redacted environment", async () => {
		const test = batchContainer();
		test.memory.controls.scriptShell((command) =>
			command.program === "/bin/zsh"
				? ok({ exitCode: 0, stdout: BATCH_ENVIRONMENT, stderr: "" })
				: null,
		);
		must(await test.container.services.settings.start());
		const router = createAppRouter(createMemoryHistory({ initialEntries: ["/diagnostics"] }));
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

		expect(await screen.findByRole("heading", { name: "Diagnostics" })).toBeTruthy();
		expect(await screen.findByText("API_TOKEN")).toBeTruthy();
		expect(screen.queryByText("super-secret")).toBeNull();
		expect(screen.getByText("LANG")).toBeTruthy();
	});

	it("APP-07 shows the Resources popover from the resource chip in the sidebar's top strip", async () => {
		const test = batchContainer();
		const workspace = await seedWorkspace(test.container, {
			branch: "alpha",
			directoryName: "alpha",
			path: "/code/workspaces/alpha",
		});
		test.memory.controls.setProcesses([
			{
				pid: 1,
				label: "rg",
				cpuPercent: 12.5,
				memoryBytes: 50 * 1024 * 1024,
				cwd: workspace.path,
			},
		]);
		test.container.services.settings.store.setState((state) => ({
			...state,
			values: { ...state.values, sidebar_resource_usage: true },
		}));
		// AppShell mounts the chip in the window controls' strip above the sidebar (renderApp @10538807).
		await renderBatchUi(
			test,
			createElement(ShellControls, {
				sidebarOpen: true,
				onToggleSidebar: () => undefined,
				resources: createElement(ResourceUsageTable, { sidebarWidth: 320 }),
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: /^Resource usage/ }));
		const table = await screen.findByRole("table", { name: "Resources" });
		expect(within(table).getByText("rg")).toBeTruthy();
		// A workspace's group is named by its folder, as Conductor names it (renderApp @5568938).
		expect(within(table).getByRole("button", { name: "alpha" })).toBeTruthy();
	});

	it("APP-10 dismisses a hint on the General page and brings it back with Reset callout dismissals", async () => {
		const test = batchContainer();
		must(await test.container.services.settings.start());
		await renderBatchUi(test, createElement(GeneralPage));

		expect(await screen.findByText(/Hints explain a control once/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		await waitFor(() =>
			expect(test.container.services.settings.get("dismissed_callouts")).toEqual([
				"callout-dismissals-hint",
			]),
		);
		await waitFor(() => expect(screen.queryByText(/Hints explain a control once/)).toBeNull());

		fireEvent.click(await screen.findByRole("button", { name: "Reset callout dismissals" }));
		await waitFor(() =>
			expect(test.container.services.settings.get("dismissed_callouts")).toEqual([]),
		);
		expect(await screen.findByText(/Hints explain a control once/)).toBeTruthy();
	});

	it("CHAT-13 shows the progress tracker above the composer", async () => {
		const test = batchContainer();
		const workspace = await seedWorkspace(test.container);
		const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
		must(await test.container.services.sessions.start());
		test.container.services.sessions.setProgress(session.id, {
			blocks: [
				{
					kind: "steps",
					steps: [
						{ label: "Plan", status: "done" },
						{ label: "Build", status: "in_progress" },
						{ label: "Ship", status: "pending" },
					],
				},
			],
		});
		await renderBatchUi(
			test,
			createElement(ChatPane, { workspaceId: workspace.id, sessionId: session.id }),
		);

		const progress = screen.getByRole("region", { name: "Progress" });
		expect(within(progress).getByText("Build")).toBeTruthy();
		expect(within(progress).getByText("2/3")).toBeTruthy();
	});

	it("CHAT-22 shows a Codex HTML write as a sandboxed visualization in the chat", async () => {
		const test = batchContainer();
		const workspace = await readyBatchWorkspace(test, "/code/workspaces/viz");
		test.memory.controls.addFile(`${workspace.path}/viz/chart.html`, "<h1>Revenue chart</h1>");
		const session = await batchChat(
			test,
			workspace.id,
			[
				userMessageEvent("e1", "t1", 1_000),
				agentEvent("e2", "t1", 2_000, [
					{
						kind: "tool_call",
						toolUseId: "tu-1" as ToolCallView["toolUseId"],
						tool: "write",
						rawName: "write",
						input: { file_path: "viz/chart.html", content: "<h1>Revenue chart</h1>" },
					},
					{
						kind: "tool_result",
						toolUseId: "tu-1" as ToolCallView["toolUseId"],
						output: "Wrote viz/chart.html",
						isError: false,
						truncated: false,
					},
				]),
			],
			{ ...CONFIG, agent: "codex" },
		);
		await renderBatchUi(
			test,
			createElement(MessageList, { sessionId: session.id, workspaceId: workspace.id }),
		);

		const frame = (await screen.findByTitle("Visualization")) as HTMLIFrameElement;
		// The page is served from the visualization scheme, not inlined as srcdoc (#466).
		await waitFor(() =>
			expect(frame.getAttribute("src")).toMatch(/^visualization:\/\/localhost\//),
		);
		expect(test.memory.controls.visualizationPages.get(frame.getAttribute("src") ?? "")).toContain(
			"<h1>Revenue chart</h1>",
		);
		expect(frame.getAttribute("sandbox") ?? "").toContain("allow-scripts");
		expect(frame.getAttribute("sandbox") ?? "").not.toContain("allow-same-origin");
	});

	it("CHAT-23 runs a shell block from the chat's Run button", async () => {
		const test = batchContainer();
		const workspace = await readyBatchWorkspace(test);
		const session = await batchChat(test, workspace.id, [
			userMessageEvent("e1", "t1", 1_000),
			agentEvent("e2", "t1", 2_000, [{ kind: "text", text: "```bash\necho hello\n```" }]),
		]);
		await renderBatchUi(
			test,
			createElement(MessageList, { sessionId: session.id, workspaceId: workspace.id }),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Run" }));

		await waitFor(() => expect(screen.getByText("Done")).toBeTruthy());
		expect(screen.getByText("Exit code 0")).toBeTruthy();
		expect(test.memory.controls.ptySpawns.at(-1)).toMatchObject({
			cwd: workspace.path,
			command: { program: "/bin/zsh", args: ["-l", "-c", "echo hello"] },
		});
	});

	it("CHAT-24 plays a video that a reply names in Markdown", async () => {
		const test = batchContainer();
		const workspace = await seedWorkspace(test.container, {
			path: "/code/workspaces/video-demo",
		});
		const session = await batchChat(test, workspace.id, [
			userMessageEvent("e1", "t1", 1_000),
			agentEvent("e2", "t1", 2_000, [{ kind: "text", text: "![Clip](media/clip.mp4)" }]),
		]);
		await renderBatchUi(
			test,
			createElement(MessageList, { sessionId: session.id, workspaceId: workspace.id }),
		);

		const video = (await screen.findByLabelText("Clip")) as HTMLVideoElement;
		expect(video.getAttribute("src")).toBe(
			`asset://localhost/${encodeURIComponent(`${workspace.path}/media/clip.mp4`)}`,
		);
	});

	it("CHAT-25 shows the turn outline beside the message list", async () => {
		const test = batchContainer();
		const workspace = await seedWorkspace(test.container);
		const session = await batchChat(test, workspace.id, [
			userMessageEvent("e1", "t1", 1_000),
			userMessageEvent("e2", "t2", 2_000),
		]);
		await renderBatchUi(
			test,
			createElement(MessageList, { sessionId: session.id, workspaceId: workspace.id }),
		);

		expect(await screen.findByRole("button", { name: "Table of contents" })).toBeTruthy();
		expect(screen.getAllByTestId("turn-outline-tick")).toHaveLength(2);
	});
});
