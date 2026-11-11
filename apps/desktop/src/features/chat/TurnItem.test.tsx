import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatBlock, ChatTurn } from "../../core/model.ts";

const state = vi.hoisted(() => ({ send: vi.fn(), toastError: vi.fn(), instances: 0 }));

vi.mock("../../ui/Toast.tsx", () => ({ toastError: state.toastError }));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ sessions: { send: state.send } }),
}));
vi.mock("./UserMessage.tsx", () => ({
	UserMessage: ({ turn }: { turn: ChatTurn }) => <div>user:{turn.userMessage?.text}</div>,
}));
vi.mock("./TurnFooter.tsx", () => ({
	TurnFooter: ({ turn }: { turn: ChatTurn }) => <div>footer:{turn.turnId}</div>,
}));
vi.mock("./ChatBanner.tsx", () => ({
	ChatBanner: ({ block, onRetry }: { block: ChatBlock; onRetry?: () => void }) => (
		<div>
			banner:
			{block.kind === "error" ? block.item.message : block.kind === "notice" ? block.item.text : ""}
			{onRetry === undefined ? null : (
				<button type="button" onClick={onRetry}>
					retry
				</button>
			)}
		</div>
	),
}));
vi.mock("./ChatBlockView.tsx", () => ({
	ChatBlockView: ({ block }: { block: ChatBlock }) => {
		// Every mounted instance gets its own number, so a remount shows as a new number.
		const instance = useRef(++state.instances).current;
		if (block.kind === "text" && block.text === "BOOM") throw new Error("render failed");
		return (
			<div data-instance={instance}>block:{block.kind === "text" ? block.text : block.kind}</div>
		);
	},
}));

const { TurnItem } = await import("./TurnItem.tsx");

beforeEach(() => {
	state.send.mockReset().mockResolvedValue(ok(undefined));
	state.toastError.mockReset();
	state.instances = 0;
});

afterEach(cleanup);

const sessionId = "s1" as Parameters<typeof TurnItem>[0]["sessionId"];

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
		...over,
	};
}

describe("CHAT-06 chat turn", () => {
	it("renders a text block and a tool block in order", () => {
		const value = turn({
			blocks: [
				{ kind: "text", text: "first" },
				{
					kind: "tool",
					call: {
						toolUseId: "tu1",
						item: { kind: "tool_call", toolUseId: "tu1", tool: "bash", rawName: "Bash", input: {} },
						result: null,
						children: [],
					} as never,
				},
			],
		});
		render(<TurnItem turn={value} sessionId={sessionId} />);
		const blocks = screen.getAllByText(/^block:/);
		expect(blocks.map((node) => node.textContent)).toEqual(["block:first", "block:tool"]);
	});

	it("keeps the other turns alive when one turn fails to render", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		render(
			<>
				<TurnItem
					turn={turn({ turnId: "broken" as never, blocks: [{ kind: "text", text: "BOOM" }] })}
					sessionId={sessionId}
				/>
				<TurnItem
					turn={turn({ turnId: "ok" as never, blocks: [{ kind: "text", text: "fine" }] })}
					sessionId={sessionId}
				/>
			</>,
		);
		expect(screen.getByText("This chat turn failed to render")).toBeTruthy();
		expect(screen.getByText("Other turns are still available.")).toBeTruthy();
		expect(screen.getByText("block:fine")).toBeTruthy();
		log.mockRestore();
	});

	it("names a cancelled turn", () => {
		const value = turn({ outcome: "cancelled", endedAt: 20 });
		render(<TurnItem turn={value} sessionId={sessionId} />);
		expect(screen.getByText("banner:Cancelled")).toBeTruthy();
	});

	it("does not blame the user for a turn that a crash cut off", () => {
		const value = turn({ outcome: "interrupted", endedAt: 20 });
		render(<TurnItem turn={value} sessionId={sessionId} />);
		expect(screen.queryByText("banner:Cancelled")).toBeNull();
		expect(screen.getByText("banner:This turn stopped before it finished.")).toBeTruthy();
	});

	it("shows a failed turn's error once when the agent's own error block already says it", () => {
		const text = "API Error: 500 Internal server error";
		const value = turn({
			outcome: "error",
			error: text,
			blocks: [
				{
					kind: "error",
					item: { kind: "error", code: "agent_server_error", message: text, retryable: true },
				},
			],
		});
		render(<TurnItem turn={value} sessionId={sessionId} />);
		expect(screen.getByText("block:error")).toBeTruthy();
		expect(screen.queryByText(`banner:${text}`)).toBeNull();
	});

	it("still shows a failed turn's error when the turn's error blocks say something else", () => {
		const value = turn({
			outcome: "error",
			error: "The Claude session ended unexpectedly.",
			blocks: [
				{
					kind: "error",
					item: { kind: "error", code: "agent_error", message: "Tool failed", retryable: false },
				},
			],
		});
		render(<TurnItem turn={value} sessionId={sessionId} />);
		expect(screen.getByText("banner:The Claude session ended unexpectedly.")).toBeTruthy();
	});

	it("keeps a streaming text block mounted while its text grows", () => {
		const first = turn({
			outcome: "running",
			endedAt: null,
			blocks: [{ kind: "text", text: "Hi" }],
		});
		const view = render(<TurnItem turn={first} sessionId={sessionId} />);
		const before = screen.getByText("block:Hi").getAttribute("data-instance");
		const grown = turn({
			outcome: "running",
			endedAt: null,
			blocks: [{ kind: "text", text: "Hi there, this is a longer reply than before." }],
		});
		view.rerender(<TurnItem turn={grown} sessionId={sessionId} />);
		const after = screen
			.getByText("block:Hi there, this is a longer reply than before.")
			.getAttribute("data-instance");
		expect(after).toBe(before);
	});

	it("resends the message from the retry button of a failed turn", async () => {
		const value = turn({ outcome: "error", error: "The model is overloaded." });
		render(<TurnItem turn={value} sessionId={sessionId} />);
		fireEvent.click(screen.getAllByRole("button", { name: "retry" })[0] as HTMLElement);
		await waitFor(() => expect(state.send).toHaveBeenCalledWith(sessionId, "Hello", [], "auto"));
		expect(state.toastError).not.toHaveBeenCalled();
	});

	it("tells the user when the retry could not be sent", async () => {
		const error = appError("sidecar_down", "The sidecar is not running.");
		state.send.mockResolvedValue(err(error));
		const value = turn({ outcome: "error", error: "The model is overloaded." });
		render(<TurnItem turn={value} sessionId={sessionId} />);
		fireEvent.click(screen.getAllByRole("button", { name: "retry" })[0] as HTMLElement);
		await waitFor(() =>
			expect(state.toastError).toHaveBeenCalledWith("Couldn't send the message again", error),
		);
	});

	it("marks a steer the agent has not read yet, and a reverted turn", () => {
		const value = turn({
			reverted: true,
			steers: [
				{ messageId: "m2" as never, text: "wait", at: 12, consumed: false },
				{ messageId: "m3" as never, text: "also this", at: 13, consumed: true },
			],
		});
		render(<TurnItem turn={value} sessionId={sessionId} />);
		expect(screen.getAllByText("Pending")).toHaveLength(1);
		expect(screen.getByText("This turn was reverted.")).toBeTruthy();
	});

	// Conductor's tones: a read steer is the user's own highlight bubble, a waiting one the muted queued one.
	it("draws a read steer in the highlight fill and a waiting one in the muted fill", () => {
		const value = turn({
			steers: [
				{ messageId: "m2" as never, text: "wait", at: 12, consumed: false },
				{ messageId: "m3" as never, text: "also this", at: 13, consumed: true },
			],
		});
		render(<TurnItem turn={value} sessionId={sessionId} />);
		expect(screen.getByText("also this").parentElement?.className).toContain(
			"bg-highlight-surface",
		);
		expect(screen.getByText("wait").parentElement?.className).toContain("bg-muted");
	});

	it("does not show a footer while the turn runs", () => {
		const value = turn({ outcome: "running", endedAt: null, usage: null });
		render(<TurnItem turn={value} sessionId={sessionId} />);
		expect(screen.queryByText(/^footer:/)).toBeNull();
	});
});
