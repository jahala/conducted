/**
 * @feature CHAT-26 Start a chat with earlier chats and plans
 * Owns: the empty chat's context shelves over the real container: the workspace line, earlier
 * chats, plans, attaching a transcript or a plan, and the failure toasts.
 * Behaviour: inventory label #340-341 and inventory:toast rows 756 to 758; Conductor's empty chat
 * (renderApp `_1a`) for the rules: only chats with a user message are listed, newest first; the
 * workspace line is "New chat in /<directory name>."; nothing shows when there is nothing to add;
 * picking an attached chat again takes it off the draft; more than five items show four and
 * "+N more".
 * Test first: an empty chat lists "Add chat transcripts:" and "Add plans:" and attaching a chat
 * puts its transcript file in the draft.
 */
import type { SessionConfig, SessionEvent } from "@conducted/protocol";
import {
	appError,
	type EventId,
	err,
	type MessageId,
	type Result,
	type ToolUseId,
	type TurnId,
} from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Session, Workspace } from "../../core/model.ts";
import {
	createTestContainer,
	seedRevertFromTurn,
	seedSessionEvent,
	seedUserMessage,
	seedWorkspace,
} from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { EmptyChat } from "./EmptyChat.tsx";

type TestContainer = ReturnType<typeof createTestContainer>;
type UserMessage = Extract<SessionEvent, { type: "user_message" }>;

const opened: TestContainer[] = [];

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	for (const test of opened.splice(0)) test.close();
});

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const userMessage = (id: string, turn: string, at: number): UserMessage => ({
	type: "user_message",
	eventId: id as EventId,
	at,
	messageId: `msg-${id}` as MessageId,
	turnId: turn as TurnId,
	text: "Fix the login bug",
	attachmentPaths: [],
	delivery: "new_turn",
	config: CONFIG,
});

const planEvent = (title: string): SessionEvent => ({
	type: "agent",
	eventId: "a1" as EventId,
	at: 12,
	turnId: "t1" as TurnId,
	message: {
		agent: "claude",
		items: [
			{
				kind: "tool_call",
				toolUseId: "tool-1" as ToolUseId,
				tool: "exit_plan_mode",
				rawName: "ExitPlanMode",
				input: { plan: `# ${title}\n\nChange it, then test it.` },
			},
		],
	},
});

const renderShelves = (test: TestContainer, workspace: Workspace, current: Session) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const tree: ReactNode = (
		<QueryClientProvider client={client}>
			<ServicesProvider container={test.container}>
				<EmptyChat
					sessionId={current.id}
					workspaceId={workspace.id}
					directory={workspace.directoryName}
					onPick={vi.fn()}
				/>
				<Toaster />
			</ServicesProvider>
		</QueryClientProvider>
	);
	return render(tree);
};

const newChat = async (test: TestContainer, workspace: Workspace, title: string) => {
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	must(await test.container.services.sessions.rename(session.id, title));
	return session;
};

const setup = async () => {
	const test = createTestContainer();
	opened.push(test);
	const workspace = await seedWorkspace(test.container, { directoryName: "login" });
	const current = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	const earlier = await newChat(test, workspace, "Login fix");
	await seedUserMessage(test.container, earlier.id, userMessage("u1", "t1", 10), 10);
	return { test, workspace, current, earlier };
};

const draftPaths = (test: TestContainer, current: Session) =>
	test.container.services.composer.draftOf(current.id).attachmentPaths;

describe("CHAT-26 empty chat context shelves", () => {
	it("names the workspace and offers the transcript and plan shelves", async () => {
		const { test, workspace, current, earlier } = await setup();
		await seedSessionEvent(test.container, earlier.id, planEvent("Fix the parser"), 12);

		renderShelves(test, workspace, current);

		expect(await screen.findByText("Add chat transcripts:")).toBeTruthy();
		expect(screen.getByText(/^New chat in/).textContent).toBe("New chat in /login.");
		expect(await screen.findByText("Add plans:")).toBeTruthy();
		expect(await screen.findByRole("button", { name: "Login fix" })).toBeTruthy();
	});

	it("leaves out chats with no user message and shows nothing when nothing is left", async () => {
		const test = createTestContainer();
		opened.push(test);
		const workspace = await seedWorkspace(test.container, { directoryName: "login" });
		const current = must(await test.container.services.sessions.create(workspace.id, CONFIG));
		await newChat(test, workspace, "Never used");

		renderShelves(test, workspace, current);

		expect(await screen.findByText("No messages yet")).toBeTruthy();
		expect(screen.queryByText("Add chat transcripts:")).toBeNull();
		expect(screen.queryByText(/^New chat in/)).toBeNull();
		expect(screen.queryByRole("button", { name: "Never used" })).toBeNull();
	});

	it("lists earlier chats newest user message first", async () => {
		const { test, workspace, current } = await setup();
		const newer = await newChat(test, workspace, "Parser work");
		await seedUserMessage(test.container, newer.id, userMessage("u2", "t2", 20), 20);

		renderShelves(test, workspace, current);

		await screen.findByRole("button", { name: "Parser work" });
		const names = screen
			.getAllByRole("button")
			.map((button) => button.getAttribute("aria-label") ?? button.textContent)
			.filter((name) => name === "Parser work" || name === "Login fix");
		expect(names).toEqual(["Parser work", "Login fix"]);
	});

	it("attaches an earlier chat's transcript to the draft", async () => {
		const { test, workspace, current, earlier } = await setup();

		renderShelves(test, workspace, current);
		fireEvent.click(await screen.findByRole("button", { name: "Login fix" }));

		await waitFor(() => expect(draftPaths(test, current)).toHaveLength(1));
		const path = draftPaths(test, current)[0] ?? "";
		expect(path.endsWith("Transcript of Login fix.md")).toBe(true);
		expect(path).not.toContain(earlier.id);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Login fix" }).getAttribute("aria-pressed")).toBe(
				"true",
			),
		);
	});

	it("takes an attached transcript off the draft when the chat is picked again", async () => {
		const { test, workspace, current } = await setup();

		renderShelves(test, workspace, current);
		const button = await screen.findByRole("button", { name: "Login fix" });
		fireEvent.click(button);
		await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
		fireEvent.click(button);

		await waitFor(() => expect(draftPaths(test, current)).toHaveLength(0));
		expect(button.getAttribute("aria-pressed")).toBe("false");
	});

	it("shows No messages in this chat when the earlier chat is empty", async () => {
		const { test, workspace, current } = await setup();
		const empty = await newChat(test, workspace, "Empty chat");
		await seedUserMessage(test.container, empty.id, userMessage("u3", "t3", 30), 30);
		await seedRevertFromTurn(test.container, empty.id, "t3" as TurnId, 31);

		renderShelves(test, workspace, current);
		fireEvent.click(await screen.findByRole("button", { name: "Empty chat" }));

		expect(await screen.findByText("No messages in this chat")).toBeTruthy();
		expect(draftPaths(test, current)).toHaveLength(0);
	});

	it("shows four chats and the rest behind +N more", async () => {
		const { test, workspace, current } = await setup();
		for (const [index, title] of ["Two", "Three", "Four", "Five", "Six"].entries()) {
			const chat = await newChat(test, workspace, title);
			const at = 20 + index;
			await seedUserMessage(test.container, chat.id, userMessage(`m${index}`, `t${index}`, at), at);
		}

		renderShelves(test, workspace, current);

		expect(await screen.findByRole("button", { name: "Six" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Three" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Two" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
		expect(await screen.findByRole("button", { name: "Two" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Login fix" })).toBeTruthy();
	});

	it("lists a plan an agent proposed and attaches it to the draft", async () => {
		const { test, workspace, current, earlier } = await setup();
		await seedSessionEvent(test.container, earlier.id, planEvent("Fix the parser"), 12);

		renderShelves(test, workspace, current);
		fireEvent.click(await screen.findByRole("button", { name: "Fix the parser" }));

		await waitFor(() => expect(draftPaths(test, current)).toHaveLength(1));
		const path = draftPaths(test, current)[0] ?? "";
		expect(path.endsWith("Fix the parser.md")).toBe(true);
	});

	it("shows Failed to attach plan when the plan cannot be saved", async () => {
		const { test, workspace, current, earlier } = await setup();
		await seedSessionEvent(test.container, earlier.id, planEvent("Fix the parser"), 12);
		vi.spyOn(test.container.platform.fs, "writeTextAtomic").mockResolvedValue(
			err(appError("fs_denied", "The file could not be written.")) as Result<never>,
		);

		renderShelves(test, workspace, current);
		fireEvent.click(await screen.findByRole("button", { name: "Fix the parser" }));

		expect(await screen.findByText("Failed to attach plan")).toBeTruthy();
	});

	it("shows Failed to attach chat transcript when the transcript cannot be saved", async () => {
		const { test, workspace, current } = await setup();
		vi.spyOn(test.container.platform.fs, "writeTextAtomic").mockResolvedValue(
			err(appError("fs_denied", "The file could not be written.")) as Result<never>,
		);

		renderShelves(test, workspace, current);
		fireEvent.click(await screen.findByRole("button", { name: "Login fix" }));

		expect(await screen.findByText("Failed to attach chat transcript")).toBeTruthy();
	});
});
