/**
 * @feature CHAT-06 Folded run of tool calls
 * Tests the summary row: its words, closed by default, and opening it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoldedRun } from "./FoldedRun.tsx";

afterEach(cleanup);

describe("CHAT-06 folded run", () => {
	it("starts closed and shows the run when opened", () => {
		render(
			<FoldedRun summary={{ toolCalls: 6, messages: 4, subAgents: 0, tools: ["bash", "read"] }}>
				<p>inside</p>
			</FoldedRun>,
		);
		const row = screen.getByRole("button", { name: "Expand 6 tool calls, 4 messages" });
		expect(row.getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByText("6 tool calls, 4 messages")).toBeTruthy();
		expect(screen.queryByText("inside")).toBeNull();

		fireEvent.click(row);

		expect(row.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("inside")).toBeTruthy();
		expect(row.getAttribute("aria-label")).toBe("Collapse 6 tool calls, 4 messages");
	});

	it("starts open when the run generated an image", () => {
		render(
			<FoldedRun summary={{ toolCalls: 3, messages: 0, subAgents: 0, tools: ["image_generation"] }}>
				<p>picture</p>
			</FoldedRun>,
		);
		expect(screen.getByText("picture")).toBeTruthy();
	});
});
