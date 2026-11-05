/**
 * @feature SIDE-12 App tool: AskUserQuestion
 * Owns: the tool that lets an agent ask the user one to four multiple-choice questions and wait.
 * Behaviour: research/conductor/claude-runner.md section 3.4: the built-in question tool is turned
 * off for Claude and replaced by this one under the same name; the tool call itself is the "wait
 * for the human" primitive; no timeout; the answer text lists one answer per question.
 * Must handle:
 *  - options may be plain strings or { label, description, preview }; both become options
 *  - the schema allows at most 4 options per question and at most 4 questions
 *  - "Other" is added by the app, so the description tells the agent not to include it
 *  - the user dismisses the question or sends a new message: the tool returns the dismissal text
 *    with isError false, so the agent carries on
 *  - the number of answers does not match the number of questions: an error result that asks the
 *    agent to retry once
 * Test first: execute() with a backend that answers [["A"]] returns the numbered answer text.
 */
import { appError } from "@conducted/shared";
import { z } from "zod";
import { formatQuestionAnswers, formatQuestionFailure, QUESTION_WITHDRAWN_TEXT } from "./format.ts";
import type { Question, ToolContext, ToolDefinition, ToolResult } from "./types.ts";

const option = z.union([
	z.string().describe("The label of the choice"),
	z.object({
		label: z.string().describe("The label of the choice"),
		description: z.string().optional().describe("One sentence on what this choice means"),
		preview: z.string().optional().describe("Text or code shown while the option is chosen"),
	}),
]);

export const askUserQuestionShape = {
	questions: z
		.array(
			z.object({
				question: z.string().describe("The full question, ending with a question mark"),
				header: z.string().optional().describe("A short label of up to 12 characters"),
				options: z.array(option).max(4).describe("Two to four choices"),
				multiSelect: z.boolean().optional().describe("True when the user may pick several"),
			}),
		)
		.min(1)
		.max(4),
};

export const askUserQuestion: ToolDefinition<typeof askUserQuestionShape> = {
	name: "AskUserQuestion",
	description:
		"Ask the user one to four multiple-choice questions and wait for the answers. Use it when a decision is theirs to make and guessing would be risky, for example a choice between two designs. Each question takes two to four options. The app adds an 'Other' field by itself, so do not add one. Do not use it for questions you can answer from the code.",
	inputShape: askUserQuestionShape,
	readOnly: true,
	idempotent: false,
	alwaysLoad: true,
	async execute(
		args: z.infer<z.ZodObject<typeof askUserQuestionShape>>,
		context: ToolContext,
	): Promise<ToolResult> {
		const questions: Question[] = args.questions.map((question) => ({
			header: question.header,
			question: question.question,
			options: question.options.map((option) =>
				typeof option === "string" ? { label: option } : option,
			),
			multiSelect: question.multiSelect ?? false,
		}));
		const result = await context.backend.askQuestions(context.sessionId, questions);
		if (!result.ok) return { text: formatQuestionFailure(result.error), isError: true };
		if (result.value === "withdrawn") {
			return { text: QUESTION_WITHDRAWN_TEXT, isError: false };
		}
		if (result.value.length !== questions.length) {
			return {
				text: formatQuestionFailure(
					appError(
						"wrong_answer_count",
						`Got ${result.value.length} answers for ${questions.length} questions.`,
					),
				),
				isError: true,
			};
		}
		return { text: formatQuestionAnswers(questions, result.value), isError: false };
	},
};
