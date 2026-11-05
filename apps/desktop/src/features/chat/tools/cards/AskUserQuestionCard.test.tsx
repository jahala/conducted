/**
 * Tests for CHAT-10: the history card lists each question with the answer it got.
 */
import type { SessionId, ToolUseId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../../../../test/dom-polyfills.ts";
import type { ToolCallView } from "../../../../core/model.ts";
import { AskUserQuestionCard } from "./AskUserQuestionCard.tsx";

const sessionId = "s1" as SessionId;

const questions = [
	{ question: "Which database?", options: [{ label: "SQLite" }, { label: "Postgres" }] },
	{ question: "Which regions?", options: [{ label: "EU" }, { label: "US" }], multiSelect: true },
	{ question: "Which name?", options: [{ label: "alpha" }] },
];

const call = (output: string | null): ToolCallView => {
	const toolUseId = "tu1" as ToolUseId;
	return {
		toolUseId,
		item: {
			kind: "tool_call",
			toolUseId,
			tool: "ask_user_question",
			rawName: "AskUserQuestion",
			input: { questions },
		},
		result:
			output === null
				? null
				: { kind: "tool_result", toolUseId, output, isError: false, truncated: false },
		children: [],
	};
};

afterEach(cleanup);

describe("CHAT-10 question history card", () => {
	it("shows each question with its answer, and a skipped one as (Skipped)", () => {
		render(
			<AskUserQuestionCard
				call={call("The user answered:\n1. Postgres\n2.\n   - EU\n   - US\n3. (no answer)")}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);

		expect(screen.getByText("Which database?")).toBeTruthy();
		expect(screen.getByText("Postgres")).toBeTruthy();
		expect(screen.getByText("Which regions?")).toBeTruthy();
		expect(screen.getByText("EU")).toBeTruthy();
		expect(screen.getByText("US")).toBeTruthy();
		expect(screen.getByText("Which name?")).toBeTruthy();
		expect(screen.getByText("(Skipped)")).toBeTruthy();
	});

	it("says the question still waits while its result has not arrived", () => {
		render(<AskUserQuestionCard call={call(null)} sessionId={sessionId} defaultExpanded />);

		expect(screen.getAllByText("Waiting for your answer").length).toBeGreaterThan(0);
	});

	it("says the question was not answered when the call was withdrawn", () => {
		render(
			<AskUserQuestionCard
				call={call("The user dismissed the question. Carry on without it.")}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);

		expect(screen.getAllByText("Not answered").length).toBe(3);
	});
});
