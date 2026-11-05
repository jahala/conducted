import type { CanonicalTool } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import type { ToolCallView } from "../../../core/model.ts";

const state = vi.hoisted(() => ({
	expand: false,
	set: vi.fn(),
}));

vi.mock("../../../core/hooks.ts", () => ({
	useSetting: () => state.expand,
	useActions: () => ({ settings: { set: state.set } }),
}));

const { ToolCard } = await import("./ToolCard.tsx");

const sessionId = "s1" as Parameters<typeof ToolCard>[0]["sessionId"];

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
		children: [],
	};
}

beforeEach(() => {
	state.expand = false;
	state.set.mockReset();
});

afterEach(cleanup);

describe("CHAT-08 tool card", () => {
	it("renders the bash card for a bash call", () => {
		render(
			<ToolCard call={view("bash", { command: "echo hi" }, "Bash", "hi")} sessionId={sessionId} />,
		);
		expect(screen.getByText("Bash")).toBeTruthy();
		expect(screen.getByText("echo hi")).toBeTruthy();
	});

	it("renders the generic card for an unknown tool", () => {
		render(<ToolCard call={view("unknown", { foo: "bar" }, "FooTool")} sessionId={sessionId} />);
		expect(screen.getByText("FooTool")).toBeTruthy();
		expect(screen.getByText(/"foo": "bar"/)).toBeTruthy();
	});

	it("turns Garry mode on with Ctrl+O", () => {
		render(
			<ToolCard call={view("bash", { command: "echo hi" }, "Bash", "hi")} sessionId={sessionId} />,
		);
		fireEvent.keyDown(window, { key: "o", ctrlKey: true });
		expect(state.set).toHaveBeenCalledWith("expand_tool_calls", true);
	});
});
