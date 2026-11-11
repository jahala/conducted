/**
 * Tests for CHAT-12: the card that marks the moment the agent switched to plan mode.
 */
import type { SessionId, ToolUseId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../../core/context.tsx";
import type { ToolCallView } from "../../../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../../../test/container.ts";
import { ToolCard } from "../ToolCard.tsx";
import { EnterPlanModeCard } from "./EnterPlanModeCard.tsx";

const sessionId = "s1" as SessionId;

const view = (isError: boolean | null): ToolCallView => {
	const toolUseId = "tu-plan" as ToolUseId;
	return {
		toolUseId,
		item: {
			kind: "tool_call",
			toolUseId,
			tool: "enter_plan_mode",
			rawName: "EnterPlanMode",
			input: {},
		},
		result:
			isError === null
				? null
				: { kind: "tool_result", toolUseId, output: "refused", isError, truncated: false },
		blocks: [],
	};
};

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	test.close();
});

describe("CHAT-12 enter plan mode card", () => {
	it("renders the title 'Enter plan mode'", () => {
		render(
			<ServicesProvider container={test.container}>
				<EnterPlanModeCard call={view(false)} sessionId={sessionId} />
			</ServicesProvider>,
		);

		expect(screen.getByText("Enter plan mode")).toBeTruthy();
	});

	it("marks a refused switch as failed", () => {
		render(
			<ServicesProvider container={test.container}>
				<EnterPlanModeCard call={view(true)} sessionId={sessionId} />
			</ServicesProvider>,
		);

		expect(screen.getByText("Failed")).toBeTruthy();
	});

	it("is reached through the tool card registry", () => {
		render(
			<ServicesProvider container={test.container}>
				<ToolCard call={view(false)} sessionId={sessionId} />
			</ServicesProvider>,
		);

		expect(screen.getByText("Enter plan mode")).toBeTruthy();
	});
});
