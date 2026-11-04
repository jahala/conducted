/**
 * @feature SIDE-12 App tools: result text
 * Owns: the plain text each tool returns to the agent. Pure functions, no I/O.
 * Behaviour: research/conductor/claude-runner.md section 3.4 (a question tool answers with a
 * numbered list of the user's answers; a cancel is reported so the agent carries on) and
 * section 4.2 (comments listed with file, line and author; terminal output labelled with its
 * source and whether it still runs). The wording is ours.
 * Must handle: no comments (a plain sentence), a multi-line comment body (indented under its
 * header), several answers for one multi-select question, an empty answer list, and zero lines of
 * terminal output.
 * Test first: formatQuestionAnswers for one multi-select question with two answers lists both on
 * indented lines under item 1.
 */
import type { DiffCommentView } from "./types.ts";

export function formatQuestionAnswers(answers: readonly (readonly string[])[]): string {
	if (answers.length === 0) return "The user gave no answers.";
	const lines = ["The user answered:"];
	answers.forEach((answer, index) => {
		const number = index + 1;
		if (answer.length <= 1) {
			lines.push(`${number}. ${answer[0] ?? "(no answer)"}`);
		} else {
			lines.push(`${number}.`);
			for (const item of answer) lines.push(`   - ${item}`);
		}
	});
	return lines.join("\n");
}

export const QUESTION_WITHDRAWN_TEXT =
	"The user dismissed the question. Carry on without it, or ask again later if it still matters.";

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
