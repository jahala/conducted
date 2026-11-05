/**
 * @feature CHAT-10 Question card
 * Owns: The wizard that shows the agent's questions one page at a time and sends the answers back.
 * Behaviour: ui-map.md 3.3 (Question UI: one page per question; header, question, option list with
 * descriptions, multi-select, secret input, 'Other...' free text (0), previous and next (arrow
 * keys), number keys 1..9 pick options, Enter submits, buttons Submit and 'Cancel agent'; answers
 * return as 'question / answer / (Skipped)'), claude-runner.md 3.4.
 * Our design choice: A skipped question sends an empty list; the tool result says '(Skipped)' and
 * the history card masks a secret answer. A secret question hides its input and has no option
 * list. The card asks
 * sessions.answer once and stays disabled while the answer is sent; if that fails it says
 * 'Could not send answers. Try again.' and lets the user send again. A failed Cancel agent says
 * 'Could not cancel the agent. Try again.'
 * Must handle: One question (no previous or next); up to four questions; a multi-select question
 * with nothing ticked (skipped, allowed); 'Other' text empty (not accepted as an answer); the
 * interaction is withdrawn while open (card disappears, typed text is lost on purpose); Cancel
 * agent calls sessions.cancel; an option preview shown while the option is focused or picked.
 * Test first: Choosing option 2 on a single-select question and pressing Enter calls
 * sessions.answer with answers [['<label 2>']].
 */

import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { type KeyboardEvent, useCallback, useRef, useState } from "react";
import { useActions } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { cn } from "../../../ui/cn.ts";
import { withKeys } from "../tools/ToolCardFrame.tsx";

export interface QuestionCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	questions: Extract<Interaction, { kind: "question" }>["questions"];
}

const CLEAR = "bg-transparent text-fg hover:bg-hover";
const PICKED = "border-accent bg-accent/10 text-fg";

export function QuestionCard({ sessionId, interactionId, questions }: QuestionCardProps) {
	const actions = useActions();
	const [page, setPage] = useState(0);
	const [chosen, setChosen] = useState<string[][]>(() => questions.map(() => []));
	const [otherTexts, setOtherTexts] = useState<string[]>(() => questions.map(() => ""));
	const [secretAnswers, setSecretAnswers] = useState<string[]>(() => questions.map(() => ""));
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState<"answer" | "cancel" | null>(null);
	const otherRefs = useRef<Array<HTMLInputElement | null>>([]);
	const busy = useRef(false);
	/** Focuses a control when it mounts, so the wizard takes the keys as it opens. */
	const focusOnMount = useCallback((node: HTMLElement | null) => {
		node?.focus();
	}, []);

	const current = questions[page];

	function goToPage(next: number): void {
		setPage(Math.max(0, Math.min(questions.length - 1, next)));
		setPreviewIndex(null);
	}

	function toggleOption(questionIndex: number, optionIndex: number): void {
		const question = questions[questionIndex];
		const option = question?.options[optionIndex];
		if (question === undefined || option === undefined) return;
		setChosen((labels) =>
			labels.map((picked, index) => {
				if (index !== questionIndex) return picked;
				if (!question.multiSelect) return [option.label];
				return picked.includes(option.label)
					? picked.filter((label) => label !== option.label)
					: [...picked, option.label];
			}),
		);
		if (!question.multiSelect) {
			setOtherTexts((texts) => texts.map((text, index) => (index === questionIndex ? "" : text)));
		}
	}

	function typeOther(questionIndex: number, text: string): void {
		const question = questions[questionIndex];
		setOtherTexts((texts) => texts.map((value, index) => (index === questionIndex ? text : value)));
		if (question !== undefined && !question.multiSelect && text.length > 0) {
			setChosen((labels) => labels.map((picked, index) => (index === questionIndex ? [] : picked)));
		}
	}

	function answersFor(questionIndex: number): string[] {
		const question = questions[questionIndex];
		if (question === undefined) return [];
		if (question.secret) {
			const secret = secretAnswers[questionIndex]?.trim() ?? "";
			return secret.length > 0 ? [secret] : [];
		}
		const picked = chosen[questionIndex] ?? [];
		const typed = otherTexts[questionIndex]?.trim() ?? "";
		if (typed.length === 0) return [...picked];
		return question.multiSelect ? [...picked, typed] : [typed];
	}

	async function submit(): Promise<void> {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setFailed(null);
		const result = await actions.sessions.answer(sessionId, interactionId, {
			kind: "question",
			answers: questions.map((_, index) => answersFor(index)),
		});
		if (!result.ok) {
			busy.current = false;
			setFailed("answer");
			setPending(false);
		}
	}

	async function cancelAgent(): Promise<void> {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setFailed(null);
		const result = await actions.sessions.cancel(sessionId);
		if (!result.ok) {
			busy.current = false;
			setFailed("cancel");
			setPending(false);
		}
	}

	function onKeyDown(event: KeyboardEvent<HTMLFieldSetElement>): void {
		const target = event.target as HTMLElement;
		const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

		if (event.key === "Enter") {
			if (event.nativeEvent.isComposing) return;
			const button = target.closest("button");
			if (button !== null && !button.hasAttribute("data-question-option")) return;
			event.preventDefault();
			void submit();
			return;
		}
		if (typing) return;

		if (event.key === "ArrowLeft") {
			event.preventDefault();
			goToPage(page - 1);
			return;
		}
		if (event.key === "ArrowRight") {
			event.preventDefault();
			goToPage(page + 1);
			return;
		}
		if (event.key === "0") {
			event.preventDefault();
			otherRefs.current[page]?.focus();
			return;
		}
		if (/^[1-9]$/.test(event.key)) {
			const option = current?.options[Number(event.key) - 1];
			if (option === undefined) return;
			event.preventDefault();
			toggleOption(page, Number(event.key) - 1);
		}
	}

	if (current === undefined) return null;

	const picked = chosen[page] ?? [];
	const selectedIndex = current.options.findIndex((option) => picked.includes(option.label));
	const preview = current.options[previewIndex ?? selectedIndex]?.preview;

	return (
		<fieldset
			aria-label="Agent question"
			onKeyDown={onKeyDown}
			className="m-0 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
		>
			<div className="flex items-center justify-between gap-2">
				{current.header ? (
					<span className="text-2xs font-medium uppercase tracking-wide text-fg-muted">
						{current.header}
					</span>
				) : (
					<span />
				)}
				{questions.length > 1 ? (
					<span className="text-2xs text-fg-subtle">
						{page + 1} of {questions.length}
					</span>
				) : null}
			</div>

			<p className="text-sm font-medium text-fg">{current.question}</p>

			{current.secret ? (
				<label className="flex flex-col gap-1 text-xs text-fg-muted">
					<span>Answer (hidden)</span>
					<input
						ref={focusOnMount}
						type="password"
						autoComplete="off"
						aria-label={current.header ?? current.question}
						value={secretAnswers[page] ?? ""}
						onChange={(event) => {
							const text = event.target.value;
							setSecretAnswers((answers) =>
								answers.map((value, index) => (index === page ? text : value)),
							);
						}}
						className="h-8 rounded-md border border-border-strong bg-canvas px-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
					/>
				</label>
			) : (
				<>
					<fieldset aria-label={current.question} className="m-0 flex flex-col gap-1 border-0 p-0">
						{withKeys(current.options, (option) => option.label, "option").map(
							({ key, item: option }, optionIndex) => {
								const selected = picked.includes(option.label);
								return (
									<button
										key={key}
										ref={optionIndex === 0 ? focusOnMount : undefined}
										type="button"
										data-question-option={optionIndex}
										aria-pressed={selected}
										onClick={() => toggleOption(page, optionIndex)}
										onFocus={() => setPreviewIndex(optionIndex)}
										onMouseEnter={() => setPreviewIndex(optionIndex)}
										className={cn(
											"flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left",
											selected ? PICKED : `${CLEAR} border-transparent`,
										)}
									>
										<span
											aria-hidden="true"
											className={cn(
												"mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border text-3xs font-medium",
												selected
													? "border-accent text-accent"
													: "border-border-strong text-fg-subtle",
											)}
										>
											{optionIndex + 1}
										</span>
										<span className="flex min-w-0 flex-col gap-0.5">
											<span className="text-sm text-fg">{option.label}</span>
											{option.description ? (
												<span className="text-xs text-fg-muted">{option.description}</span>
											) : null}
										</span>
									</button>
								);
							},
						)}
					</fieldset>

					{preview ? (
						<pre className="overflow-x-auto rounded-sm bg-canvas p-2 font-mono text-code text-fg-muted">
							{preview}
						</pre>
					) : null}

					<label className="flex flex-col gap-1 text-xs text-fg-muted">
						<span>Other...</span>
						<input
							ref={(node) => {
								otherRefs.current[page] = node;
							}}
							type="text"
							aria-label="Other answer"
							placeholder="Type your answer"
							value={otherTexts[page] ?? ""}
							onChange={(event) => typeOther(page, event.target.value)}
							className="h-8 rounded-md border border-border-strong bg-canvas px-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
						/>
					</label>
				</>
			)}

			{failed !== null ? (
				<p role="alert" className="text-xs text-danger">
					{failed === "answer"
						? "Could not send answers. Try again."
						: "Could not cancel the agent. Try again."}
				</p>
			) : null}

			<div className="flex items-center justify-between gap-2">
				<Button variant="secondary" onClick={() => void cancelAgent()} disabled={pending}>
					Cancel agent
				</Button>
				<Button onClick={() => void submit()} loading={pending}>
					Submit
				</Button>
			</div>
		</fieldset>
	);
}
