/**
 * Tests for CHAT-10: the question wizard sends the chosen options back to the agent.
 */
import type { Interaction } from "@conducted/protocol";
import { appError, err, type InteractionId, ok, type SessionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { QuestionCard } from "./QuestionCard.tsx";

const state = vi.hoisted(() => ({
	answer: vi.fn(),
	cancel: vi.fn(),
}));

vi.mock("../../../core/hooks.ts", () => ({
	useActions: () => ({
		sessions: { answer: state.answer, cancel: state.cancel },
	}),
}));

type Question = Extract<Interaction, { kind: "question" }>["questions"][number];

const sessionId = "s1" as SessionId;
const interactionId = "i1" as InteractionId;

const option = (label: string, extra: { description?: string; preview?: string } = {}) => ({
	label,
	...extra,
});

const question = (changes: Partial<Question> & Pick<Question, "question">): Question => ({
	options: [],
	multiSelect: false,
	...changes,
});

const renderCard = (questions: Question[]) =>
	render(
		<QuestionCard sessionId={sessionId} interactionId={interactionId} questions={questions} />,
	);

const card = () => screen.getByRole("group", { name: "Agent question" });

beforeEach(() => {
	state.answer.mockReset().mockResolvedValue(ok(undefined));
	state.cancel.mockReset().mockResolvedValue(ok(undefined));
});

afterEach(cleanup);

describe("CHAT-10 question card", () => {
	it("choosing option 2 on a single-select question and pressing Enter answers with its label", async () => {
		renderCard([
			question({
				question: "Which database?",
				options: [option("SQLite"), option("Postgres")],
			}),
		]);

		fireEvent.click(screen.getByRole("button", { name: "Postgres" }));
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [["Postgres"]],
			}),
		);
	});

	it("number keys pick an option and Enter submits", async () => {
		renderCard([
			question({
				question: "Which database?",
				options: [option("SQLite"), option("Postgres")],
			}),
		]);

		fireEvent.keyDown(card(), { key: "2" });
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [["Postgres"]],
			}),
		);
	});

	it("a multi-select question sends every ticked option, and none ticked is skipped", async () => {
		const questions = [
			question({
				question: "Which regions?",
				multiSelect: true,
				options: [option("EU"), option("US"), option("Asia")],
			}),
		];
		const { unmount } = renderCard(questions);

		fireEvent.click(screen.getByRole("button", { name: "EU" }));
		fireEvent.click(screen.getByRole("button", { name: "Asia" }));
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [["EU", "Asia"]],
			}),
		);

		unmount();
		state.answer.mockClear();
		renderCard(questions);
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [[]],
			}),
		);
	});

	it("offers an Other free-text answer, focused by key 0", async () => {
		renderCard([question({ question: "Which database?", options: [option("SQLite")] })]);

		fireEvent.keyDown(card(), { key: "0" });
		expect(document.activeElement).toBe(screen.getByLabelText("Other answer"));

		fireEvent.change(screen.getByLabelText("Other answer"), { target: { value: "DuckDB" } });
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [["DuckDB"]],
			}),
		);
	});

	it("moves between questions with the arrow keys and submits one answer each", async () => {
		renderCard([
			question({ question: "Which database?", options: [option("SQLite")] }),
			question({ question: "Which region?", options: [option("EU")] }),
		]);

		expect(screen.getByText("Which database?")).toBeTruthy();
		fireEvent.keyDown(card(), { key: "ArrowRight" });
		expect(screen.getByText("Which region?")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "EU" }));
		fireEvent.keyDown(card(), { key: "ArrowLeft" });
		fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [["SQLite"], ["EU"]],
			}),
		);
	});

	it("masks a secret answer", async () => {
		renderCard([question({ question: "What is the token?", secret: true })]);

		const input = screen.getByLabelText("What is the token?");
		expect(input.getAttribute("type")).toBe("password");
		fireEvent.change(input, { target: { value: "hunter2" } });
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [["hunter2"]],
			}),
		);
	});

	it("shows an option preview when the option is picked", () => {
		renderCard([
			question({
				question: "Which layout?",
				options: [option("Split", { preview: "left | right" })],
			}),
		]);

		fireEvent.click(screen.getByRole("button", { name: "Split" }));
		expect(screen.getByText("left | right")).toBeTruthy();
	});

	it("cancels the agent from the Cancel agent button", async () => {
		renderCard([question({ question: "Which database?", options: [option("SQLite")] })]);

		fireEvent.click(screen.getByRole("button", { name: "Cancel agent" }));

		await waitFor(() => expect(state.cancel).toHaveBeenCalledWith(sessionId));
	});

	it("comes back with a retry message when the answer cannot be sent", async () => {
		state.answer
			.mockResolvedValueOnce(err(appError("sidecar_down", "The sidecar is not running.")))
			.mockResolvedValueOnce(ok(undefined));
		renderCard([question({ question: "Which database?", options: [option("SQLite")] })]);

		fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
		fireEvent.keyDown(card(), { key: "Enter" });

		expect(await screen.findByText("Could not send answers. Try again.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();

		fireEvent.keyDown(card(), { key: "Enter" });
		await waitFor(() => expect(state.answer).toHaveBeenCalledTimes(2));
	});
});
