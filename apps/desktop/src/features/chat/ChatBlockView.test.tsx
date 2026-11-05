import { notImplemented } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatBlock } from "../../core/model.ts";

vi.mock("./AssistantText.tsx", () => ({
	AssistantText: ({ text }: { text: string }) => <div>markdown:{text}</div>,
}));
vi.mock("./ChatBanner.tsx", () => ({
	ChatBanner: ({ block }: { block: { kind: string } }) => <div>banner:{block.kind}</div>,
}));
vi.mock("./ThinkingBlock.tsx", () => ({
	ThinkingBlock: ({ text }: { text: string }) => {
		if (text === "UNBUILT") throw notImplemented("CHAT-09");
		if (text === "BOOM") throw new Error("render failed");
		return <div>thinking:{text}</div>;
	},
}));
vi.mock("./TodoBlock.tsx", () => ({
	TodoBlock: () => <div>todo</div>,
}));
vi.mock("./tools/ToolCard.tsx", () => ({
	ToolCard: ({ call }: { call: { toolUseId: string } }) => <div>tool:{call.toolUseId}</div>,
}));

const { ChatBlockView } = await import("./ChatBlockView.tsx");

afterEach(cleanup);

const sessionId = "s1" as Parameters<typeof ChatBlockView>[0]["sessionId"];

describe("CHAT-06 block view", () => {
	it("renders the tool card for a tool block", () => {
		const block: ChatBlock = {
			kind: "tool",
			call: {
				toolUseId: "tu1" as never,
				item: {
					kind: "tool_call",
					toolUseId: "tu1" as never,
					tool: "bash",
					rawName: "Bash",
					input: {},
				},
				result: null,
				children: [],
			},
		};
		render(<ChatBlockView block={block} sessionId={sessionId} />);
		expect(screen.getByText("tool:tu1")).toBeTruthy();
	});

	it("renders a banner for a notice block", () => {
		const block: ChatBlock = {
			kind: "notice",
			item: { kind: "notice", notice: "compacted", text: "" },
		};
		render(<ChatBlockView block={block} sessionId={sessionId} />);
		expect(screen.getByText("banner:notice")).toBeTruthy();
	});

	it("renders assistant text for a text block", () => {
		render(<ChatBlockView block={{ kind: "text", text: "hello" }} sessionId={sessionId} />);
		expect(screen.getByText("markdown:hello")).toBeTruthy();
	});

	it("shows one line for a block whose view is not built yet, not an error for the whole list", () => {
		render(
			<ChatBlockView
				block={{ kind: "thinking", text: "UNBUILT", summarized: false }}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("Thinking: Not built yet: CHAT-09")).toBeTruthy();
	});

	it("shows one line for a block that throws and logs the error", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		render(
			<ChatBlockView
				block={{ kind: "thinking", text: "BOOM", summarized: false }}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("Thinking: This part failed to load.")).toBeTruthy();
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});

	it("tries a streaming block again when more text arrives", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const view = render(
			<ChatBlockView
				block={{ kind: "thinking", text: "BOOM", summarized: false }}
				sessionId={sessionId}
			/>,
		);
		view.rerender(
			<ChatBlockView
				block={{ kind: "thinking", text: "fine now", summarized: false }}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("thinking:fine now")).toBeTruthy();
		log.mockRestore();
	});
});
