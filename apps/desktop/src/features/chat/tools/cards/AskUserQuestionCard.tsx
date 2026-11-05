/**
 * @feature CHAT-10 Question history card
 * Owns: The card in the history for a question the agent asked: the questions and the answers
 * given.
 * Behaviour: ui-map.md 3.3 ('User input' card for AskUserQuestion; the tool result lists each
 * question, its answer and '(Skipped)').
 * Must handle: Still open (the live QuestionCard is in the dock, this card says 'Waiting for your
 * answer'); skipped answers; the question was withdrawn by a new message ('Not answered'); a
 * question flagged `secret` (the answer is masked, and the header says so).
 * Test first: A completed question shows each question with its answer, and a skipped one shows
 * '(Skipped)'.
 */
import {
	arrayField,
	asRecord,
	boolField,
	ToolCardFrame,
	textField,
	toolStatus,
	withKeys,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

interface AskedQuestion {
	question: string;
	header: string | null;
	secret: boolean;
}

/**
 * Reads the numbered answer list the AskUserQuestion tool returns: a numbered question line, then
 * its answers indented below it. A blank answer says '(Skipped)'. Null means the text is not an
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
			const items: string[] = [];
			answers[Number(numbered[1]) - 1] = items;
			current = items;
			continue;
		}
		if (!started || current === null || !/^\s+/.test(line)) continue;
		const bullet = /^\s*-\s+(.*)$/.exec(line);
		const item = (bullet?.[1] ?? line).trim();
		if (item.length === 0 || item === "(Skipped)") continue;
		current.push(item);
	}
	return started ? answers : null;
}

function askedQuestions(input: unknown): AskedQuestion[] {
	const questions: AskedQuestion[] = [];
	for (const value of arrayField(input, "questions")) {
		const record = asRecord(value);
		const question = textField(record, "question");
		if (question === null) continue;
		questions.push({
			question,
			header: textField(record, "header"),
			secret: boolField(record, "secret"),
		});
	}
	return questions;
}

/** Fixed mask: it hides the answer without showing how long it is. */
const MASK = "••••••••";

export function AskUserQuestionCard({ call, defaultExpanded }: ToolCardProps) {
	const questions = askedQuestions(call.item.input);
	const output = call.result?.output ?? "";
	const answers = call.result === null ? null : parseQuestionAnswers(output);
	const notAnswered = call.result !== null && answers === null;
	const anyHidden = questions.some(
		(question, index) => question.secret && (answers?.[index]?.length ?? 0) > 0,
	);

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
								{call.result === null ? (
									"Waiting for your answer"
								) : notAnswered ? (
									"Not answered"
								) : answer.length === 0 ? (
									"(Skipped)"
								) : question.secret ? (
									<span role="img" aria-label="Hidden answer">
										{MASK}
									</span>
								) : (
									withKeys(answer, (value) => value, "answer").map(({ key, item: value }) => (
										<span key={key} className="block">
											{value}
										</span>
									))
								)}
							</span>
						</div>
					);
				})}
			</div>
		);

	return (
		<ToolCardFrame
			title="User input"
			summary={
				call.result === null ? "Waiting for your answer" : anyHidden ? "Answers hidden" : undefined
			}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={body}
		/>
	);
}
