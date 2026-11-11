import { CANONICAL_TOOLS } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolCallView } from "../../../core/model.ts";
import { GenericToolCard } from "./cards/GenericToolCard.tsx";
import { toolCardFor } from "./registry.ts";
import { ToolCardFrame, toolStatus } from "./ToolCardFrame.tsx";

afterEach(cleanup);

describe("CHAT-08 tool card registry", () => {
	it.each(CANONICAL_TOOLS)("has a card for %s", (tool) => {
		expect(typeof toolCardFor(tool)).toBe("function");
	});

	it("shows the generic card for an unknown tool", () => {
		expect(toolCardFor("unknown")).toBe(GenericToolCard);
	});

	it("gives each tool kind its own card except the generic fallback", () => {
		const cards = CANONICAL_TOOLS.filter((t) => t !== "unknown").map((t) => toolCardFor(t));
		expect(new Set(cards).size).toBe(cards.length);
	});
});

const call = (result: ToolCallView["result"]): ToolCallView => ({
	toolUseId: "tu1" as ToolCallView["toolUseId"],
	item: {
		kind: "tool_call",
		toolUseId: "tu1" as ToolCallView["toolUseId"],
		tool: "bash",
		rawName: "Bash",
		input: {},
	},
	result,
	blocks: [],
});

describe("CHAT-08 tool status", () => {
	it("is running until a result arrives", () => {
		expect(toolStatus(call(null))).toBe("running");
	});
	it("is error when the result says so", () => {
		const result = {
			kind: "tool_result",
			toolUseId: "tu1" as ToolCallView["toolUseId"],
			output: "no",
			isError: true,
			truncated: false,
		} as const;
		expect(toolStatus(call(result))).toBe("error");
		expect(toolStatus(call({ ...result, isError: false }))).toBe("done");
	});
});

describe("CHAT-08 tool card frame", () => {
	it("starts a finished card closed and opens its body on click", () => {
		render(<ToolCardFrame title="Read" summary="src/a.ts" status="done" body={<p>excerpt</p>} />);
		expect(screen.queryByText("excerpt")).toBeNull();
		const toggle = screen.getByRole("button", { name: /Read/ });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(toggle);
		expect(screen.getByText("excerpt")).toBeTruthy();
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
	});

	it("opens a failed card and names the failure in words", () => {
		render(<ToolCardFrame title="Bash" status="error" body={<p>exit 1</p>} />);
		expect(screen.getByText("exit 1")).toBeTruthy();
		expect(screen.getByText("Failed")).toBeTruthy();
	});

	it("announces a running tool", () => {
		render(<ToolCardFrame title="Grep" status="running" />);
		expect(screen.getByRole("status", { name: "Grep is running" })).toBeTruthy();
	});

	it("is not a button when there is no body", () => {
		render(<ToolCardFrame title="Skill" status="done" />);
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("opens every card in Garry mode", () => {
		render(<ToolCardFrame title="Read" status="done" body={<p>excerpt</p>} expandAll />);
		expect(screen.getByText("excerpt")).toBeTruthy();
	});

	it("follows Garry mode when it is switched on and off while the card is on screen", () => {
		const card = (expandAll: boolean) => (
			<ToolCardFrame title="Read" status="done" body={<p>excerpt</p>} expandAll={expandAll} />
		);
		const view = render(card(false));
		expect(screen.queryByText("excerpt")).toBeNull();
		view.rerender(card(true));
		expect(screen.getByText("excerpt")).toBeTruthy();
		view.rerender(card(false));
		expect(screen.queryByText("excerpt")).toBeNull();
	});
});
