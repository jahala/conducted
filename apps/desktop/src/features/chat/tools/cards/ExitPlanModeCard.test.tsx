/**
 * Tests for CHAT-12: the card for a plan the agent proposed, its decision and its Copy plan menu.
 */
import type { SessionId, ToolUseId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../../../test/dom-polyfills.ts";
import { ServicesProvider } from "../../../../core/context.tsx";
import type { ToolCallView } from "../../../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../../../test/container.ts";
import { ToolCard } from "../ToolCard.tsx";
import { ExitPlanModeCard } from "./ExitPlanModeCard.tsx";

const sessionId = "s1" as SessionId;
const plan = "First, change the parser.\nThen run the tests.";

const view = (
	changes: { plan?: string; output?: string; isError?: boolean } = {},
): ToolCallView => {
	const toolUseId = "tu-plan" as ToolUseId;
	return {
		toolUseId,
		item: {
			kind: "tool_call",
			toolUseId,
			tool: "exit_plan_mode",
			rawName: "ExitPlanMode",
			input: { plan: changes.plan ?? plan },
		},
		result:
			changes.output === undefined
				? null
				: {
						kind: "tool_result",
						toolUseId,
						output: changes.output,
						isError: changes.isError ?? false,
						truncated: false,
					},
		children: [],
	};
};

let test: TestContainer;

const renderCard = (call: ToolCallView, defaultExpanded = false) =>
	render(
		<ServicesProvider container={test.container}>
			<ExitPlanModeCard call={call} sessionId={sessionId} defaultExpanded={defaultExpanded} />
		</ServicesProvider>,
	);

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	test.close();
});

describe("CHAT-12 propose plan card", () => {
	it("renders the proposed plan text", () => {
		renderCard(view(), true);

		expect(screen.getByText(/First, change the parser/)).toBeTruthy();
	});

	it("says the plan is waiting for review before it is decided", () => {
		renderCard(view());

		expect(screen.getByText("Waiting for you to review the plan")).toBeTruthy();
	});

	it("says Approved after the plan is approved", () => {
		renderCard(view({ output: "Plan approved.", isError: false }));

		expect(screen.getByText("Approved")).toBeTruthy();
	});

	it("says Rejected and shows the feedback the agent received", () => {
		renderCard(view({ output: "Use a smaller change.", isError: true }), true);

		expect(screen.getByText("Rejected")).toBeTruthy();
		expect(screen.getByText("Use a smaller change.")).toBeTruthy();
	});

	it("shows a long plan collapsed with a Show all control", () => {
		const longPlan = Array.from({ length: 60 }, (_, index) => `Step ${index + 1}`).join("\n");
		renderCard(view({ plan: longPlan }), true);

		expect(screen.queryByText(/Step 60/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Show all 60 lines/ }));
		expect(screen.getByText(/Step 60/)).toBeTruthy();
	});

	it("copies the plan from its right-click menu", async () => {
		renderCard(view(), true);

		fireEvent.contextMenu(screen.getByText(/First, change the parser/));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy plan" }));

		await waitFor(() => expect(test.memory.controls.clipboardText).toBe(plan));
	});

	it("is reached through the tool card registry", () => {
		render(
			<ServicesProvider container={test.container}>
				<ToolCard call={view()} sessionId={sessionId} />
			</ServicesProvider>,
		);

		expect(screen.getByText("Propose plan")).toBeTruthy();
	});
});
