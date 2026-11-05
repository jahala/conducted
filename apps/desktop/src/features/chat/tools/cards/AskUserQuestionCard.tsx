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
import {
	arrayField,
	asRecord,
	ToolCardFrame,
	textField,
	toolStatus,
	withKeys,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

interface AskedQuestion {
	question: string;
	header: string | null;
}

/**
 * Reads the numbered answer list the AskUserQuestion tool returns. Null means the text is not an
 * answer list, which is what a withdrawn or failed call looks like.
 */
export function parseQuestionAnswers(output: string): string[][] | null {
	const answers: string[][] = [];
	let current: string[] | null = null;
	let started = false;
	for (const line of output.split(/\r?\n/)) {
		const numbered = /^\s*(\d+)\.\s*(.*)$/.exec(line);
		if (numbered !== null) {
			started = true;
			const index = Number(numbered[1]) - 1;
			const item = numbered[2]?.trim() ?? "";
			const items: string[] = [];
			if (item.length > 0 && item !== "(no answer)") items.push(item);
			answers[index] = items;
			current = items;
			continue;
		}
		const bullet = /^\s+-\s+(.*)$/.exec(line);
		if (bullet !== null && current !== null) {
			const item = bullet[1]?.trim() ?? "";
			if (item.length > 0) current.push(item);
		}
	}
	return started ? answers : null;
}

function askedQuestions(input: unknown): AskedQuestion[] {
	const questions: AskedQuestion[] = [];
	for (const value of arrayField(input, "questions")) {
		const record = asRecord(value);
		const question = textField(record, "question");
		if (question === null) continue;
		questions.push({ question, header: textField(record, "header") });
	}
	return questions;
}

export function AskUserQuestionCard({ call, defaultExpanded }: ToolCardProps) {
	const questions = askedQuestions(call.item.input);
	const output = call.result?.output ?? "";
	const answers = call.result === null ? null : parseQuestionAnswers(output);
	const notAnswered = call.result !== null && answers === null;

	const body =
		questions.length === 0 ? (
			<p className="text-xs text-fg-muted">No questions were recorded for this call.</p>
		) : (
			<div className="flex flex-col gap-3">
				{questions.map((question, index) => {
					const answer = answers?.[index] ?? [];
					return (
						<div
							key={`${question.header ?? ""}:${question.question}`}
							className="flex flex-col gap-1"
						>
							{question.header ? (
								<span className="text-2xs font-medium uppercase tracking-wide text-fg-muted">
									{question.header}
								</span>
							) : null}
							<span className="text-sm text-fg">{question.question}</span>
							<span className="text-sm text-fg-muted">
								{call.result === null
									? "Waiting for your answer"
									: notAnswered
										? "Not answered"
										: answer.length === 0
											? "(Skipped)"
											: withKeys(answer, (value) => value, "answer").map(({ key, item: value }) => (
													<span key={key} className="block">
														{value}
													</span>
												))}
							</span>
						</div>
					);
				})}
			</div>
		);

	return (
		<ToolCardFrame
			title="User input"
			summary={call.result === null ? "Waiting for your answer" : undefined}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={body}
		/>
	);
}
