import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatBlock, ChatTurn } from "../../core/model.ts";

const state = vi.hoisted(() => ({ send: vi.fn() }));

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
	ChatBanner: ({ block }: { block: ChatBlock }) => (
		<div>
			banner:
			{block.kind === "error" ? block.item.message : block.kind === "notice" ? block.item.text : ""}
		</div>
	),
}));
vi.mock("./ChatBlockView.tsx", () => ({
	ChatBlockView: ({ block }: { block: ChatBlock }) => {
		if (block.kind === "text" && block.text === "BOOM") throw new Error("render failed");
		return <div>block:{block.kind === "text" ? block.text : block.kind}</div>;
	},
}));

const { TurnItem } = await import("./TurnItem.tsx");

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
				{ kind: "tool", call: {} as never },
			],
		});
		render(<TurnItem turn={value} sessionId={sessionId} isLast />);
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
					isLast={false}
				/>
				<TurnItem
					turn={turn({ turnId: "ok" as never, blocks: [{ kind: "text", text: "fine" }] })}
					sessionId={sessionId}
					isLast
				/>
			</>,
		);
		expect(screen.getByText("This chat turn failed to render.")).toBeTruthy();
		expect(screen.getByText("Other turns are still available.")).toBeTruthy();
		expect(screen.getByText("block:fine")).toBeTruthy();
		log.mockRestore();
	});

	it("marks an interrupted turn", () => {
		const value = turn({ outcome: "interrupted", endedAt: 20 });
		render(<TurnItem turn={value} sessionId={sessionId} isLast />);
		expect(screen.getByText("banner:Interrupted by user")).toBeTruthy();
	});

	it("does not show a footer while the turn runs", () => {
		const value = turn({ outcome: "running", endedAt: null, usage: null });
		render(<TurnItem turn={value} sessionId={sessionId} isLast />);
		expect(screen.queryByText(/^footer:/)).toBeNull();
	});
});
