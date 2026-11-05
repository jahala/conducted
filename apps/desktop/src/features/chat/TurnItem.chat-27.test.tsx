/**
 * @feature CHAT-27 Visible auto-retry with Retry now
 * Behaviour: ui-map.md 3.3 (the running turn shows the agent's retry with Retry now; a failed turn
 * offers Retry in new chat).
 * Test first: Retry now stops the retrying turn and sends its message again; the error card names
 * the turn to retry in a new chat.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatBlock, ChatTurn } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	cancel: vi.fn(),
	send: vi.fn(),
	lastRetry: null as null | {
		retry: { attempt: number; maxAttempts: number };
		onRetryNow: () => void;
		retryInNewChat: { sessionId: string; turnId: string };
	},
	lastBanner: null as null | {
		retryInNewChat?: { sessionId: string; turnId: string };
	},
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({
		sessions: { cancel: state.cancel, send: state.send },
	}),
}));
vi.mock("./UserMessage.tsx", () => ({ UserMessage: () => <div>user message</div> }));
vi.mock("./TurnFooter.tsx", () => ({ TurnFooter: () => <div>footer</div> }));
vi.mock("./ChatBlockView.tsx", () => ({ ChatBlockView: () => null }));
vi.mock("./ChatBanner.tsx", () => ({
	ChatBanner: ({
		block,
		retryInNewChat,
	}: {
		block: ChatBlock;
		retryInNewChat?: { sessionId: string; turnId: string };
	}) => {
		state.lastBanner = { retryInNewChat };
		return <div>banner:{block.kind === "error" ? block.item.message : block.kind}</div>;
	},
	ChatRetryBanner: (props: NonNullable<typeof state.lastRetry>) => {
		state.lastRetry = props;
		return (
			<div>
				retrying {props.retry.attempt}/{props.retry.maxAttempts}
				<button type="button" onClick={props.onRetryNow}>
					Retry now
				</button>
			</div>
		);
	},
}));

const { TurnItem } = await import("./TurnItem.tsx");

const sessionId = "s1" as Parameters<typeof TurnItem>[0]["sessionId"];

function turn(over: Partial<ChatTurn> = {}): ChatTurn {
	return {
		turnId: "t1" as ChatTurn["turnId"],
		startedBy: "user",
		userMessage: {
			messageId: "m1" as never,
			text: "Fix the login bug",
			attachmentPaths: ["/draft/login.png"],
			at: 10,
			sender: null,
		},
		steers: [],
		blocks: [],
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		outcome: "running",
		error: null,
		startedAt: 10,
		endedAt: null,
		usage: null,
		reverted: false,
		...over,
	};
}

beforeEach(() => {
	state.cancel.mockReset().mockResolvedValue(ok(undefined));
	state.send.mockReset().mockResolvedValue(ok(undefined));
	state.lastRetry = null;
	state.lastBanner = null;
});

afterEach(cleanup);

describe("CHAT-27 retry actions on a turn", () => {
	it("stops the retrying turn and sends its message again from Retry now", async () => {
		render(<TurnItem turn={turn()} sessionId={sessionId} retry={{ attempt: 1, maxAttempts: 3 }} />);

		expect(screen.getByText("retrying 1/3")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry now" }));

		await waitFor(() => expect(state.cancel).toHaveBeenCalledWith(sessionId));
		await waitFor(() =>
			expect(state.send).toHaveBeenCalledWith(
				sessionId,
				"Fix the login bug",
				["/draft/login.png"],
				"auto",
			),
		);
	});

	it("hands the failed turn to the error card for Retry in new chat", () => {
		render(
			<TurnItem turn={turn({ outcome: "error", error: "It broke." })} sessionId={sessionId} />,
		);

		expect(state.lastBanner?.retryInNewChat).toEqual({
			sessionId,
			turnId: turn().turnId,
		});
	});
});
