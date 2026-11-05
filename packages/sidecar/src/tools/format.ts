/**
 * @feature SIDE-12 App tools: result text
 * Owns: the plain text each tool returns to the agent. Pure functions, no I/O.
 * Behaviour: research/conductor/claude-runner.md section 3.4 and ui-map.md 3.3 (the tool answers
 * with each question, the answer given and "(Skipped)" when the question was skipped; a cancel is
 * reported so the agent carries on) and section 4.2 (comments listed with file, line and author;
 * terminal output labelled with its source and whether it still runs). The wording is ours.
 * Must handle: no comments (a plain sentence), a multi-line comment body (indented under its
 * header), several answers for one multi-select question, an empty answer list, and zero lines of
 * terminal output.
 * Test first: formatQuestionAnswers for one multi-select question with two answers lists the
 * question and both answers on indented lines under item 1.
 */
import type { AppError } from "@conducted/shared";
import type { DiffCommentView } from "./types.ts";

export function formatQuestionAnswers(
	questions: readonly { question: string }[],
	answers: readonly (readonly string[])[],
): string {
	if (questions.length === 0 || answers.length === 0) return "The user gave no answers.";
	const lines = ["The user answered:"];
	questions.forEach((question, index) => {
		const answer = answers[index] ?? [];
		lines.push(`${index + 1}. ${question.question}`);
		if (answer.length === 0) {
			lines.push("   (Skipped)");
		} else if (answer.length === 1) {
			lines.push(`   ${answer[0]}`);
		} else {
			for (const item of answer) lines.push(`   - ${item}`);
		}
	});
	return lines.join("\n");
}

export const QUESTION_WITHDRAWN_TEXT =
	"The user dismissed the question. Carry on without it, or ask again later if it still matters.";

/** Why a question failed, whether asking again helps, and what the agent should do next. */
export function formatQuestionFailure(error: AppError): string {
	const retry = error.code !== "no_session_callbacks";
	const action = retry
		? "Call AskUserQuestion once more if the question is still relevant."
		: "Continue without the answer.";
	return `AskUserQuestion failed: ${error.message} (${error.code}).\nRetry: ${retry ? "yes" : "no"}.\n${action}`;
}

export function formatDiffComments(comments: readonly DiffCommentView[]): string {
	if (comments.length === 0) return "There are no review comments on the diff.";
	return comments
		.map((comment) => {
			const where =
				comment.endLine !== undefined && comment.endLine !== comment.line
					? `${comment.file}:${comment.line}-${comment.endLine}`
					: `${comment.file}:${comment.line}`;
			const state = comment.resolved ? `${comment.author}, resolved` : comment.author;
			const body = comment.body
				.split("\n")
				.map((line) => `  ${line}`)
				.join("\n");
			return `${where} [${state}]\n${body}`;
		})
		.join("\n\n");
}

export function formatTerminalOutput(result: {
	output: string;
	source: string;
	running: boolean;
}): string {
	const header = `[${result.source}, ${result.running ? "still running" : "stopped"}]`;
	return result.output === "" ? `${header}\n(no output yet)` : `${header}\n${result.output}`;
}
