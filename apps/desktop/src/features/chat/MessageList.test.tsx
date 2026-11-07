import { idleLiveState } from "@conducted/protocol";
import { appError, err } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, runCommandHandlers } from "../../app/command-dispatcher.ts";
import type { ChatTurn, ChatView, Session, Workspace } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	chat: null as unknown,
	workspace: null as unknown,
	expand: false,
	setSetting: vi.fn(),
	saveDraft: vi.fn(),
	send: vi.fn(),
	toastError: vi.fn(),
	renders: {} as Record<string, number>,
}));

vi.mock("../../core/hooks.ts", () => ({
	useChat: () => state.chat,
	useWorkspace: () => state.workspace,
	useDraft: () => ({ text: "", attachmentPaths: [] }),
	useSessions: () => ({ state: "ready", data: [] }),
	usePlans: () => ({ state: "ready", data: [] }),
	useSetting: () => state.expand,
	useLiveShortcut: () => null,
	useShortcutOverrides: () => ({ overrides: {}, error: null }),
	useActions: () => ({
		settings: { set: state.setSetting },
		sessions: { saveDraft: state.saveDraft, send: state.send },
	}),
}));

vi.mock("../../ui/Toast.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../ui/Toast.tsx")>()),
	toastError: state.toastError,
}));

vi.mock("./UserMessage.tsx", () => ({
	UserMessage: ({ turn }: { turn: ChatTurn }) => {
		const id = String(turn.turnId);
		state.renders[id] = (state.renders[id] ?? 0) + 1;
		return <div data-testid="user-message" data-turn={id} />;
	},
}));
vi.mock("./ChatBlockView.tsx", () => ({ ChatBlockView: () => null }));
vi.mock("./TurnFooter.tsx", () => ({ TurnFooter: () => null }));
vi.mock("./ChatBanner.tsx", () => ({ ChatBanner: () => null }));

const { MessageList } = await import("./MessageList.tsx");

const sessionId = "s1" as Parameters<typeof MessageList>[0]["sessionId"];
const workspaceId = "w1" as Parameters<typeof MessageList>[0]["workspaceId"];

function makeTurn(index: number): ChatTurn {
	return {
		turnId: `t${index}` as ChatTurn["turnId"],
		startedBy: "user",
		userMessage: {
			messageId: `m${index}` as never,
			text: `message ${index}`,
			attachmentPaths: [],
			at: index,
			sender: null,
		},
		steers: [],
		blocks: [{ kind: "text", text: `reply ${index}` }],
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "success",
		error: null,
		startedAt: index,
		endedAt: index + 1,
		usage: null,
		reverted: false,
	};
}

function session(): Session {
	return {
		id: sessionId,
		workspaceId,
		title: null,
		config: {
			agent: "claude",
			model: "default",
			effort: "high",
			fastMode: false,
			planMode: false,
			requireToolApproval: true,
			additionalDirectories: [],
			appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
		},
		agentSessionId: null,
		forkResumeNativeMessageId: null,
		unreadCount: 0,
		contextUsedTokens: null,
		contextWindowTokens: null,
		queuePausedAt: null,
		closedAt: null,
		lastUserMessageAt: 1,
		createdAt: 1,
		updatedAt: 1,
	};
}

function workspace(over: Partial<Workspace> = {}): Workspace {
	return {
		id: workspaceId,
		repoId: "r1" as Workspace["repoId"],
		directoryName: "workspace",
		path: "/tmp/workspace",
		branch: "conducted/workspace",
		branchIsPlaceholder: false,
		host: { kind: "local" },
		displayName: null,
		targetBranch: "main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 4100,
		pinnedAt: null,
		notes: null,
		linkedPaths: [],
		prNumber: null,
		prTitle: null,
		prDescription: null,
		archiveCommit: null,
		archivedAt: null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 1,
		createdAt: 1,
		updatedAt: 1,
		...over,
	};
}

function view(turns: ChatTurn[]): ChatView {
	return {
		session: session(),
		turns,
		liveState: idleLiveState,
		queued: [],
		openInteraction: null,
		progress: null,
		goal: null,
	};
}

const wrap = (ui: React.ReactNode) => (
	<VirtuosoMockContext.Provider value={{ viewportHeight: 300, itemHeight: 100 }}>
		{ui}
	</VirtuosoMockContext.Provider>
);

beforeEach(() => {
	clearCommandHandlers();
	state.renders = {};
	state.expand = false;
	state.toastError.mockReset();
	state.chat = { state: "ready", data: view([makeTurn(0)]) };
	state.workspace = { state: "ready", data: workspace() };
	for (const fn of [state.setSetting, state.saveDraft, state.send]) fn.mockReset();
	state.setSetting.mockResolvedValue({ ok: true, value: undefined });
	state.saveDraft.mockReturnValue(undefined);
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
});

describe("CHAT-06 message list", () => {
	it("mounts only a small window of turns for a very long chat", async () => {
		const turns = Array.from({ length: 2000 }, (_, index) => makeTurn(index));
		state.chat = { state: "ready", data: view(turns) };
		render(wrap(<MessageList sessionId={sessionId} workspaceId={workspaceId} />));
		await waitFor(() => expect(screen.getAllByTestId("user-message").length).toBeGreaterThan(0));
		const mounted = new Set(
			screen.getAllByTestId("user-message").map((node) => node.getAttribute("data-turn")),
		);
		expect(mounted.size).toBeLessThan(40);
		expect(mounted.has("t0")).toBe(false);
	});

	it("re-renders only the tail turn when the last turn grows", async () => {
		const turns = Array.from({ length: 2000 }, (_, index) => makeTurn(index));
		state.chat = { state: "ready", data: view(turns) };
		const rendered = render(wrap(<MessageList sessionId={sessionId} workspaceId={workspaceId} />));
		await waitFor(() => expect(screen.getAllByTestId("user-message").length).toBeGreaterThan(0));

		const before = { ...state.renders };
		const last = turns[1999] as ChatTurn;
		const next = [
			...turns.slice(0, 1999),
			{ ...last, blocks: [...last.blocks, { kind: "text" as const, text: "more" }] },
		];
		state.chat = { state: "ready", data: view(next) };
		rendered.rerender(wrap(<MessageList sessionId={sessionId} workspaceId={workspaceId} />));

		await waitFor(() => expect(state.renders.t1999).toBeGreaterThan(before.t1999 ?? 0));
		expect(state.renders.t1998).toBe(before.t1998);
	});

	it("shows the empty chat starters and fills the draft when one is picked", async () => {
		state.chat = { state: "ready", data: view([]) };
		render(wrap(<MessageList sessionId={sessionId} workspaceId={workspaceId} />));
		fireEvent.click(await screen.findByRole("button", { name: "Fix a known bug" }));
		expect(state.saveDraft).toHaveBeenCalledWith(sessionId, {
			text: "Fix a known bug",
			attachmentPaths: [],
		});
	});

	it("offers no starters in an archived workspace", async () => {
		state.chat = { state: "ready", data: view([]) };
		state.workspace = { state: "ready", data: workspace({ state: "archived" }) };
		render(wrap(<MessageList sessionId={sessionId} workspaceId={workspaceId} />));
		expect(await screen.findByText("No messages yet")).toBeTruthy();
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});

	it("registers the Expand all tool calls command for the list", async () => {
		render(wrap(<MessageList sessionId={sessionId} workspaceId={workspaceId} />));
		await screen.findByTestId("user-message");
		expect(runCommandHandlers("chat.expandAllToolCalls")).toBe(true);
		expect(state.setSetting).toHaveBeenCalledWith("expand_tool_calls", true);
	});

	it("tells the user when the Expand all tool calls setting could not be saved", async () => {
		const error = appError("write_failed", "The settings file is read-only.");
		state.setSetting.mockResolvedValue(err(error));
		render(wrap(<MessageList sessionId={sessionId} workspaceId={workspaceId} />));
		await screen.findByTestId("user-message");
		runCommandHandlers("chat.expandAllToolCalls");
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Couldn't change the tool call setting", error),
		);
	});

	it("turns Expand all tool calls off when it is on", async () => {
		state.expand = true;
		render(wrap(<MessageList sessionId={sessionId} workspaceId={workspaceId} />));
		await screen.findByTestId("user-message");
		runCommandHandlers("chat.expandAllToolCalls");
		expect(state.setSetting).toHaveBeenCalledWith("expand_tool_calls", false);
	});
});
