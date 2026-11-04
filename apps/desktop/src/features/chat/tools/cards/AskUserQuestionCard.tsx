/**
 * @feature CHAT-10 Question history card
 * Owns: The card in the history for a question the agent asked: the questions and the answers
 * given.
 * Behaviour: ui-map.md 3.3 ('User input' card for AskUserQuestion; answers as 'question / answer /
 * (Skipped)').
 * Must handle: Still open (the live QuestionCard is in the dock, this card says 'Waiting for your
 * answer'); skipped answers; the question was withdrawn by a new message ('Not answered').
 * Test first: A completed question shows each question with its answer, and a skipped one shows
 * '(Skipped)'.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function AskUserQuestionCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-10");
}
