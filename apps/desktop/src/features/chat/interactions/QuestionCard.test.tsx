/**
 * Tests for CHAT-10: the question wizard sends the chosen options back to the agent.
 */
import type { Interaction } from "@conducted/protocol";
import { appError, err, type InteractionId, ok, type SessionId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./QuestionCard.tsx";

const state = vi.hoisted(() => ({
	answer: vi.fn(),
	cancel: vi.fn(),
	overrides: {} as Record<string, string[]>,
}));

vi.mock("../../../core/hooks.ts", () => ({
	useActions: () => ({
		sessions: { answer: state.answer, cancel: state.cancel },
	}),
	// The card reads the user's rebinds and the send-key setting, as the Keyboard shortcuts page saves them.
	useShortcutOverrides: () => ({ overrides: state.overrides, error: null }),
	useSetting: () => "enter",
	useLiveShortcut: () => null,
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

// The card is named by its question, as Conductor's has no group name of its own (D098).
const card = () => screen.getByRole("group");

beforeEach(() => {
	state.overrides = {};
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

		fireEvent.click(screen.getByRole("radio", { name: "Postgres" }));
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

		fireEvent.click(screen.getByRole("checkbox", { name: "EU" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Asia" }));
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
		expect(document.activeElement).toBe(screen.getByLabelText("Other response"));

		fireEvent.change(screen.getByLabelText("Other response"), { target: { value: "DuckDB" } });
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

		fireEvent.click(screen.getByRole("radio", { name: "EU" }));
		fireEvent.keyDown(card(), { key: "ArrowLeft" });
		fireEvent.click(screen.getByRole("radio", { name: "SQLite" }));
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [["SQLite"], ["EU"]],
			}),
		);
	});

	it("follows the user's rebinds: N goes to the next question, and A and B pick options", async () => {
		state.overrides = {
			"chat.question.next": ["N"],
			"chat.question.selectOption": ["A", "B"],
		};
		renderCard([
			question({ question: "Which database?", options: [option("SQLite"), option("Postgres")] }),
			question({ question: "Which host?", options: [option("Fly"), option("Render")] }),
		]);

		fireEvent.keyDown(card(), { key: "b" });
		fireEvent.keyDown(card(), { key: "ArrowRight" });
		expect(screen.getByText("Which database?")).toBeTruthy();

		fireEvent.keyDown(card(), { key: "n" });
		expect(screen.getByText("Which host?")).toBeTruthy();
		fireEvent.keyDown(card(), { key: "a" });
		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(state.answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "question",
				answers: [["Postgres"], ["Fly"]],
			}),
		);
	});

	it("masks a secret answer", async () => {
		renderCard([question({ question: "What is the token?", secret: true })]);

		const input = screen.getByLabelText("Other response");
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

	it("focuses a secret field once, and does not take focus back on a later render", () => {
		const questions = [question({ question: "What is the token?", secret: true })];
		const { rerender } = renderCard(questions);
		expect(document.activeElement).toBe(screen.getByLabelText("Other response"));

		const cancel = screen.getByRole("button", { name: "Cancel agent" });
		cancel.focus();
		rerender(
			<QuestionCard sessionId={sessionId} interactionId={interactionId} questions={questions} />,
		);

		expect(document.activeElement).toBe(cancel);
	});

	// This test asserted our option preview. Conductor's card shows none (D098).
	it("shows no option preview when the option is picked, and names the card by its question", () => {
		renderCard([
			question({
				question: "Which layout?",
				options: [option("Split", { preview: "left | right" })],
			}),
		]);

		fireEvent.click(screen.getByRole("radio", { name: "Split" }));
		expect(screen.queryByText("left | right")).toBeNull();
		expect(screen.getByRole("group", { name: "Which layout?" })).toBeTruthy();
	});

	it("draws Conductor's rows: a number, the label and the choice state", () => {
		renderCard([
			question({
				header: "Storage",
				question: "Which database?",
				options: [option("SQLite", { description: "One file" }), option("Postgres")],
			}),
		]);

		const sqlite = screen.getByRole("radio", { name: /SQLite/ });
		expect(sqlite.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(sqlite);
		expect(sqlite.getAttribute("aria-checked")).toBe("true");
		expect(sqlite.textContent).toBe("1SQLiteOne file");
		expect(screen.getByText("Storage")).toBeTruthy();
		expect(screen.getByPlaceholderText("Other…")).toBeTruthy();
		expect(screen.queryByText("1 of 1")).toBeNull();
	});

	it("moves between questions with the dots and the arrow buttons", () => {
		renderCard([
			question({ question: "Which database?", options: [option("SQLite")] }),
			question({ question: "Which region?", options: [option("EU")] }),
		]);

		expect(
			(screen.getByRole("button", { name: "Previous question" }) as HTMLButtonElement).disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Next question" }));
		expect(screen.getByText("Which region?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Question 1" }));
		expect(screen.getByText("Which database?")).toBeTruthy();
	});

	it("ticks Other on a multi-select question while it holds text, and clears it when unticked", () => {
		renderCard([
			question({ question: "Which regions?", multiSelect: true, options: [option("EU")] }),
		]);

		const other = screen.getByLabelText("Other response");
		const tick = screen.getByRole("checkbox", { name: "Select other response" });
		expect(tick.getAttribute("aria-checked")).toBe("false");
		fireEvent.change(other, { target: { value: "Mars" } });
		expect(tick.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(tick);
		expect((other as HTMLTextAreaElement).value).toBe("");
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

		fireEvent.click(screen.getByRole("radio", { name: "SQLite" }));
		fireEvent.keyDown(card(), { key: "Enter" });

		expect(await screen.findByText("Could not send answers. Try again.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();

		fireEvent.keyDown(card(), { key: "Enter" });
		await waitFor(() => expect(state.answer).toHaveBeenCalledTimes(2));
	});

	it("says so when the agent cannot be cancelled, and lets the user try again", async () => {
		state.cancel
			.mockResolvedValueOnce(err(appError("sidecar_down", "The sidecar is not running.")))
			.mockResolvedValueOnce(ok(undefined));
		renderCard([question({ question: "Which database?", options: [option("SQLite")] })]);

		fireEvent.click(screen.getByRole("button", { name: "Cancel agent" }));

		expect(await screen.findByText("Could not cancel the agent. Try again.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel agent" }));
		await waitFor(() => expect(state.cancel).toHaveBeenCalledTimes(2));
	});
});
