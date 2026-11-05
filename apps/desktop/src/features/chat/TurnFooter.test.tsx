import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	copyText: vi.fn(),
	forkFrom: vi.fn(),
	revertTo: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({
		app: { copyText: state.copyText },
		sessions: { forkFrom: state.forkFrom, revertTo: state.revertTo },
	}),
}));

const { TurnFooter } = await import("./TurnFooter.tsx");

beforeEach(() => {
	for (const fn of Object.values(state)) {
		fn.mockReset();
		fn.mockResolvedValue({ ok: true, value: undefined });
	}
});
afterEach(cleanup);

const sessionId = "s1" as Parameters<typeof TurnFooter>[0]["sessionId"];

function turn(over: Partial<ChatTurn> = {}): ChatTurn {
	return {
		turnId: "t1" as ChatTurn["turnId"],
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
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "success",
		error: null,
		startedAt: 10,
		endedAt: 20,
		usage: {
			costUsd: 0.01,
			inputTokens: 12,
			outputTokens: 34,
			cacheReadTokens: 56,
			cacheWriteTokens: 78,
			fastMode: true,
			model: "test-model",
		},
		reverted: false,
		...over,
	};
}

describe("CHAT-06 turn footer", () => {
	it("shows token counts in the details hover card", async () => {
		render(<TurnFooter turn={turn()} sessionId={sessionId} />);
		fireEvent.focus(screen.getByRole("button", { name: "Turn details" }));
		expect((await screen.findAllByText(/Input 12/)).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/Output 34/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/Cache read 56/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/Cache write 78/).length).toBeGreaterThan(0);
	});

	it("copies the final message", async () => {
		render(<TurnFooter turn={turn()} sessionId={sessionId} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy final message" }));
		expect(state.copyText).toHaveBeenCalledWith("The final answer.");
	});

	it("copies a summary of the turn", async () => {
		render(<TurnFooter turn={turn()} sessionId={sessionId} />);
		fireEvent.click(screen.getByRole("button", { name: "Copy summary" }));
		expect(state.copyText).toHaveBeenCalledWith(expect.stringContaining("User: Hello"));
		expect(state.copyText).toHaveBeenCalledWith(
			expect.stringContaining("Assistant: The final answer."),
		);
	});

	it("disables Reset without a checkpoint", async () => {
		render(<TurnFooter turn={turn()} sessionId={sessionId} />);
		const trigger = screen.getByRole("button", { name: "More turn actions" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		const reset = await screen.findByRole("menuitem", { name: "Reset chat" });
		expect(reset.getAttribute("aria-disabled")).toBe("true");
	});
});
