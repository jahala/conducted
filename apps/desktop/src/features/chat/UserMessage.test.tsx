import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";

const state = vi.hoisted(() => ({
	copyText: vi.fn(),
	revertTo: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({
		app: { copyText: state.copyText },
		sessions: { revertTo: state.revertTo },
	}),
}));

const { UserMessage } = await import("./UserMessage.tsx");

afterEach(() => {
	cleanup();
	state.copyText.mockReset();
	state.revertTo.mockReset();
});

const sessionId = "s1" as Parameters<typeof UserMessage>[0]["sessionId"];

function turn(over: Partial<ChatTurn["userMessage"]> = {}): ChatTurn {
	return {
		turnId: "t1" as ChatTurn["turnId"],
		startedBy: "user",
		userMessage: {
			messageId: "m1" as never,
			text: "Hello there",
			attachmentPaths: [],
			at: 10,
			sender: null,
			...over,
		},
		steers: [],
		blocks: [],
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "success",
		error: null,
		startedAt: 10,
		endedAt: 20,
		usage: null,
		reverted: false,
	};
}

describe("CHAT-06 user message", () => {
	it("renders one item for each attachment path", async () => {
		renderWithRouter(
			<UserMessage
				turn={turn({ attachmentPaths: ["/tmp/shot.png", "/tmp/notes.txt"] })}
				sessionId={sessionId}
			/>,
		);
		expect(await screen.findByText("shot.png")).toBeTruthy();
		expect(screen.getByText("notes.txt")).toBeTruthy();
		expect(screen.getAllByTestId("attachment")).toHaveLength(2);
	});

	it("shows Retry and Discard after a failed send", async () => {
		const onRetry = vi.fn();
		const onDiscard = vi.fn();
		renderWithRouter(
			<UserMessage
				turn={turn()}
				sessionId={sessionId}
				failed={{ message: "Message not sent", error: "The network is down." }}
				onRetry={onRetry}
				onDiscard={onDiscard}
			/>,
		);
		expect(await screen.findByText("Message not sent")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onDiscard).toHaveBeenCalledTimes(1);
	});

	it("marks a message sent from another session", async () => {
		renderWithRouter(
			<UserMessage
				turn={turn({ sender: { kind: "other_chat", sessionId: "s2" as never } })}
				sessionId={sessionId}
			/>,
		);
		expect(await screen.findByText("Sent from another session")).toBeTruthy();
	});

	it("marks a message sent from Claude", async () => {
		renderWithRouter(
			<UserMessage turn={turn({ sender: { kind: "claude_ai" } })} sessionId={sessionId} />,
		);
		expect(await screen.findByText("Sent via Claude")).toBeTruthy();
	});

	it("copies the message from the right-click menu", async () => {
		state.copyText.mockResolvedValue({ ok: true, value: undefined });
		renderWithRouter(<UserMessage turn={turn()} sessionId={sessionId} />);
		fireEvent.contextMenu(await screen.findByText("Hello there"));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy message" }));
		expect(state.copyText).toHaveBeenCalledWith("Hello there");
	});

	it("turns mention tokens into chips", async () => {
		renderWithRouter(
			<UserMessage
				turn={turn({ text: "Look at ⟦file:src/app.ts⟧ and ⟦pr:12⟧" })}
				sessionId={sessionId}
			/>,
		);
		expect(await screen.findByRole("button", { name: "src/app.ts" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "PR #12" })).toBeTruthy();
	});
});
