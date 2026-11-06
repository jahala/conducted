import { appError, err } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatTurn } from "../../core/model.ts";

const navigate = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
	copyText: vi.fn(),
	cancel: vi.fn(),
	forkFrom: vi.fn(),
	revertTo: vi.fn(),
	setSetting: vi.fn(),
	toastError: vi.fn(),
	settings: {} as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

vi.mock("../../ui/Toast.tsx", () => ({ toastError: state.toastError }));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({
		app: { copyText: state.copyText },
		sessions: { cancel: state.cancel, forkFrom: state.forkFrom, revertTo: state.revertTo },
		settings: { set: state.setSetting },
	}),
	useSetting: (key: string) => state.settings[key] ?? false,
}));

const { TurnFooter } = await import("./TurnFooter.tsx");

beforeEach(() => {
	for (const fn of [
		state.copyText,
		state.cancel,
		state.forkFrom,
		state.revertTo,
		state.setSetting,
	]) {
		fn.mockReset();
		fn.mockResolvedValue({ ok: true, value: undefined });
	}
	state.toastError.mockReset();
	state.settings = {};
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

	it("shows the fast mode state in the details hover card", async () => {
		render(<TurnFooter turn={turn()} sessionId={sessionId} />);
		fireEvent.focus(screen.getByRole("button", { name: "Turn details" }));
		expect((await screen.findAllByText(/Fast mode on/)).length).toBeGreaterThan(0);
	});

	it("shows the turn's cost only while Show agent cost is on", async () => {
		const first = render(<TurnFooter turn={turn()} sessionId={sessionId} />);
		fireEvent.focus(screen.getByRole("button", { name: "Turn details" }));
		expect((await screen.findAllByText(/Input 12/)).length).toBeGreaterThan(0);
		expect(screen.queryAllByText(/Cost \$0\.01/)).toEqual([]);
		first.unmount();

		state.settings = { experimental_show_agent_cost: true };
		render(<TurnFooter turn={turn()} sessionId={sessionId} />);
		fireEvent.focus(screen.getByRole("button", { name: "Turn details" }));
		expect((await screen.findAllByText(/Cost \$0\.01/)).length).toBeGreaterThan(0);
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

	async function openMenu() {
		const trigger = screen.getByRole("button", { name: "More turn actions" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
	}

	it("opens the reset dialog from the turn menu", async () => {
		render(<TurnFooter turn={turn({ startCheckpointId: "c1" })} sessionId={sessionId} />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Reset chat" }));
		expect(await screen.findByRole("heading", { name: "Reset chat?" })).toBeTruthy();
		expect(state.revertTo).not.toHaveBeenCalled();
	});

	it("shows why a reset failed and keeps the dialog open", async () => {
		const error = appError("git_failed", "The checkpoint is gone.");
		state.revertTo.mockResolvedValue(err(error));
		render(<TurnFooter turn={turn({ startCheckpointId: "c1" })} sessionId={sessionId} />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Reset chat" }));
		fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
		expect(await screen.findByText("The checkpoint is gone.")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Reset chat?" })).toBeTruthy();
	});

	it("tells the user when a fork fails", async () => {
		const error = appError("git_failed", "Cannot fork.");
		state.forkFrom.mockResolvedValue(err(error));
		render(<TurnFooter turn={turn({ endCheckpointId: "c2" })} sessionId={sessionId} />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: "Fork to new tab" }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Unable to fork chat", error),
		);
	});

	it("tells the user when a copy from the menu fails, and gives Fork a reason when disabled", async () => {
		const error = appError("clipboard", "The clipboard is busy.");
		state.copyText.mockResolvedValue(err(error));
		render(<TurnFooter turn={turn()} sessionId={sessionId} />);
		await openMenu();
		const fork = await screen.findByRole("menuitem", { name: "Fork to new tab" });
		expect(fork.getAttribute("aria-disabled")).toBe("true");
		expect(fork.getAttribute("title")).toBe("This turn has no checkpoint to fork from.");
		fireEvent.click(screen.getByRole("menuitem", { name: "Copy summary" }));
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Couldn't copy the text", error),
		);
	});
});
