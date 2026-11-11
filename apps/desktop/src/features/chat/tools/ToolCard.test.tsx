import type { CanonicalTool } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallView } from "../../../core/model.ts";
import { TOOL_CARDS } from "./registry.ts";

const state = vi.hoisted(() => ({
	expand: false,
}));

vi.mock("../../../core/hooks.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../core/hooks.ts")>();
	return { ...actual, useSetting: () => state.expand };
});

const { ToolCard } = await import("./ToolCard.tsx");

const sessionId = "s1" as Parameters<typeof ToolCard>[0]["sessionId"];
const originalBashCard = TOOL_CARDS.bash;

function ThrowingCard(): never {
	throw new Error("render failed");
}

function view(
	tool: CanonicalTool,
	input: unknown,
	rawName?: string,
	output?: string,
): ToolCallView {
	const toolUseId = "tu1" as ToolCallView["toolUseId"];
	return {
		toolUseId,
		item: { kind: "tool_call", toolUseId, tool, rawName: rawName ?? tool, input },
		result:
			output === undefined
				? null
				: { kind: "tool_result", toolUseId, output, isError: false, truncated: false },
		blocks: [],
	};
}

beforeEach(() => {
	state.expand = false;
});

afterEach(() => {
	cleanup();
	TOOL_CARDS.bash = originalBashCard;
});

describe("CHAT-08 tool card", () => {
	it("renders the bash card for a bash call", () => {
		render(
			<ToolCard call={view("bash", { command: "echo hi" }, "Bash", "hi")} sessionId={sessionId} />,
		);
		expect(screen.getByText("Bash")).toBeTruthy();
		expect(screen.getByText("echo hi")).toBeTruthy();
	});

	it("renders a command on the Mac with its command and output", () => {
		state.expand = true;
		render(
			<ToolCard
				call={view(
					"app_tool",
					{ command: "echo hi", reason: "It is on the Mac." },
					"mcp__conducted__RunLocalCommand",
					"hi",
				)}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("Local command")).toBeTruthy();
		expect(screen.getAllByText("echo hi").length).toBeGreaterThan(0);
		expect(screen.getByText("It is on the Mac.")).toBeTruthy();
		expect(screen.getByText("hi")).toBeTruthy();
	});

	it("renders the generic card for an unknown tool", () => {
		render(<ToolCard call={view("unknown", { foo: "bar" }, "FooTool")} sessionId={sessionId} />);
		expect(screen.getByText("FooTool")).toBeTruthy();
		expect(screen.getByText(/"foo": "bar"/)).toBeTruthy();
	});

	it("shows the body of every card when the Expand all tool calls setting is on", () => {
		state.expand = true;
		render(
			<ToolCard
				call={view("bash", { command: "echo hi" }, "Bash", "hello")}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("hello")).toBeTruthy();
	});

	it("shows one error line naming the tool when its card throws", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		TOOL_CARDS.bash = ThrowingCard;
		render(
			<ToolCard call={view("bash", { command: "echo hi" }, "Bash", "hi")} sessionId={sessionId} />,
		);
		expect(screen.getByRole("status").textContent).toBe("Tool: Bash: This part failed to load.");
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});

	it("names the missing feature when a card is a placeholder, without leaving the turn", () => {
		TOOL_CARDS.bash = () => notImplemented("CHAT-09");
		render(<ToolCard call={view("bash", { command: "echo hi" }, "Bash")} sessionId={sessionId} />);
		expect(screen.getByRole("status").textContent).toBe("Tool: Bash: Not built yet: CHAT-09");
	});
});
