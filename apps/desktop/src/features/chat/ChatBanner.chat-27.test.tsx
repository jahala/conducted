/**
 * @feature CHAT-27 Visible auto-retry with Retry now
 * Behaviour: ui-map.md 3.3 (a failed turn shows 'Something went wrong, retrying n/m' with Retry now
 * while the agent retries by itself; the error card offers Retry in new chat).
 * Test first: the retry banner names the attempt with a Retry now button, and the error card starts
 * the turn again in a new chat.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatBlock } from "../../core/model.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";

const state = vi.hoisted(() => ({ retryInNewChat: vi.fn(), copyText: vi.fn() }));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({
		app: { copyText: state.copyText },
		sessions: { retryInNewChat: state.retryInNewChat },
	}),
}));

const { ChatBanner, ChatRetryBanner } = await import("./ChatBanner.tsx");

afterEach(() => {
	cleanup();
	state.retryInNewChat.mockReset();
	state.copyText.mockReset();
});

const error = (): Extract<ChatBlock, { kind: "error" }> => ({
	kind: "error",
	item: { kind: "error", code: "boom", message: "It broke.", retryable: true },
});

const target = { sessionId: "s1" as never, turnId: "t1" as never };

describe("CHAT-27 visible auto-retry", () => {
	it("names the retry attempt and offers Retry now", () => {
		const onRetryNow = vi.fn();
		render(<ChatRetryBanner retry={{ attempt: 2, maxAttempts: 3 }} onRetryNow={onRetryNow} />);

		expect(screen.getByText("Something went wrong, retrying 2/3")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
		expect(onRetryNow).toHaveBeenCalledTimes(1);
	});

	it("keeps the agent's reason beside the retry count", () => {
		render(
			<ChatRetryBanner
				retry={{ attempt: 1, maxAttempts: 4, error: "The model is overloaded." }}
				onRetryNow={vi.fn()}
			/>,
		);

		expect(screen.getByText("The model is overloaded.")).toBeTruthy();
	});

	it("starts the failed turn's message in a new chat from the error card", async () => {
		state.retryInNewChat.mockResolvedValue({ ok: true, value: { id: "s2" } });
		renderWithRouter(<ChatBanner block={error()} retryInNewChat={target} />);

		fireEvent.click(await screen.findByRole("button", { name: "Retry in new chat" }));

		await waitFor(() =>
			expect(state.retryInNewChat).toHaveBeenCalledWith(target.sessionId, target.turnId),
		);
	});

	it("offers Retry in new chat from the auto-retry banner too", () => {
		renderWithRouter(
			<ChatRetryBanner
				retry={{ attempt: 1, maxAttempts: 3 }}
				onRetryNow={vi.fn()}
				retryInNewChat={target}
			/>,
		);

		expect(screen.getByRole("button", { name: "Retry in new chat" })).toBeTruthy();
	});

	it("keeps Retry in new chat out of the error card when the caller gives no turn", () => {
		render(<ChatBanner block={error()} />);

		expect(screen.queryByRole("button", { name: "Retry in new chat" })).toBeNull();
	});
});
