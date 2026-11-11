/**
 * @feature CHAT-16 Fork a chat from a turn
 * Tests the turn footer's Fork to new tab action over the real container: a fork opens the copied
 * chat in a new tab, also with the Experimental setting off (the setting gates only the tab menu
 * and Cmd+Alt+Enter), and a turn with no checkpoint shows "Unable to fork chat".
 * Test first: choosing Fork to new tab opens a different chat than the one on screen.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId, TurnId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { ChatTurn } from "../../core/model.ts";
import {
	agentEvent,
	appendChatEvents,
	checkpointEvent,
	turnEndedEvent,
	userMessageEvent,
} from "../../test/chat-events.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const navigate = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../../ui/Toast.tsx", () => ({ toastError }));

const { TurnFooter } = await import("./TurnFooter.tsx");

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
	turnId: "t1" as TurnId,
	startedBy: "user",
	userMessage: {
		messageId: "m1" as never,
		text: "Hello",
		attachmentPaths: [],
		at: 10,
		sender: null,
	},
	steers: [],
	blocks: [{ kind: "text", text: "The final answer." }],
	startCheckpointId: "start-1",
	endCheckpointId: "end-1",
	changes: [],
	outcome: "success",
	error: null,
	startedAt: 10,
	endedAt: 20,
	usage: null,
	reverted: false,
	...over,
});

afterEach(() => {
	cleanup();
	navigate.mockReset();
	toastError.mockReset();
});

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

async function seedChat(): Promise<{
	container: ReturnType<typeof createTestContainer>;
	workspaceId: string;
	sessionId: SessionId;
}> {
	const test = createTestContainer();
	await test.container.services.settings.start();
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const created = await test.container.services.sessions.create(workspace.id, CONFIG);
	if (!created.ok) throw new Error(JSON.stringify(created.error));
	return { container: test, workspaceId: workspace.id, sessionId: created.value.id };
}

async function openMenu(): Promise<void> {
	const trigger = screen.getByRole("button", { name: "Show message actions" });
	trigger.focus();
	fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("CHAT-16 fork from the turn footer", () => {
	it("forking opens a different chat in a new tab", async () => {
		const { container: test, workspaceId, sessionId } = await seedChat();
		try {
			await appendChatEvents(test.container, sessionId, [
				userMessageEvent("u1", "t1", 10),
				checkpointEvent("c1", "t1", 11, "start", "start-1"),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
				checkpointEvent("c2", "t1", 13, "end", "end-1"),
				turnEndedEvent("e1", "t1", 14),
			]);

			render(
				<ServicesProvider container={test.container}>
					<TurnFooter turn={turn()} sessionId={sessionId} />
				</ServicesProvider>,
			);
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: "Fork to new tab" }));

			await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
			const call = navigate.mock.calls[0]?.[0] as {
				search: (previous: Record<string, unknown>) => Record<string, unknown>;
			};
			const patch = call.search({ tab: "file", path: "notes.md" });
			expect(patch).toMatchObject({ tab: "session", path: "notes.md" });
			expect(patch.sessionId).toBeTruthy();
			expect(patch.sessionId).not.toBe(sessionId);

			expect(
				test.container.services.sessions.store.getState().byWorkspace[workspaceId],
			).toHaveLength(2);
			expect(toastError).not.toHaveBeenCalled();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("forks from the turn menu with the Experimental 'Fork chat to new tab' setting off", async () => {
		const { container: test, workspaceId, sessionId } = await seedChat();
		try {
			must(await test.container.services.settings.set("experimental_fork_to_new_tab", false));
			expect(test.container.services.settings.get<boolean>("experimental_fork_to_new_tab")).toBe(
				false,
			);
			await appendChatEvents(test.container, sessionId, [
				userMessageEvent("u1", "t1", 10),
				checkpointEvent("c1", "t1", 11, "start", "start-1"),
				agentEvent("a1", "t1", 12, [{ kind: "text", text: "First answer" }]),
				checkpointEvent("c2", "t1", 13, "end", "end-1"),
				turnEndedEvent("e1", "t1", 14),
			]);

			render(
				<ServicesProvider container={test.container}>
					<TurnFooter turn={turn()} sessionId={sessionId} />
				</ServicesProvider>,
			);
			await openMenu();
			const item = await screen.findByRole("menuitem", { name: "Fork to new tab" });
			expect(item.getAttribute("aria-disabled")).not.toBe("true");
			fireEvent.click(item);

			await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
			expect(
				test.container.services.sessions.store.getState().byWorkspace[workspaceId],
			).toHaveLength(2);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("shows 'Unable to fork chat' when the turn has no checkpoint", async () => {
		const { container: test, sessionId } = await seedChat();
		try {
			await appendChatEvents(test.container, sessionId, [
				userMessageEvent("u1", "t1", 10),
				agentEvent("a1", "t1", 11, [{ kind: "text", text: "First answer" }]),
				turnEndedEvent("e1", "t1", 12),
			]);

			render(
				<ServicesProvider container={test.container}>
					<TurnFooter
						turn={turn({ startCheckpointId: "start-1", endCheckpointId: "end-1" })}
						sessionId={sessionId}
					/>
				</ServicesProvider>,
			);
			await openMenu();
			fireEvent.click(await screen.findByRole("menuitem", { name: "Fork to new tab" }));

			await waitFor(() =>
				expect(toastError).toHaveBeenCalledWith("Unable to fork chat", {
					code: "chat_fork_no_checkpoint",
					message: "Checkpoint not found for this turn.",
				}),
			);
			expect(navigate).not.toHaveBeenCalled();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
