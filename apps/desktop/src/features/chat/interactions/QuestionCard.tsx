/**
 * @feature CHAT-10 Question card
 * Owns: The wizard that shows the agent's questions one page at a time and sends the answers back.
 * Behaviour: ui-map.md 3.3 (Question UI: one page per question; header, question, option list with
 * descriptions, multi-select, secret input, 'Other...' free text (0), previous and next (arrow
 * keys), number keys 1..9 pick options, Enter submits, buttons Submit and 'Cancel agent'; answers
 * return as 'question / answer / (Skipped)'), claude-runner.md 3.4.
 * Structure (Conductor's question card, renderApp @8144303): the header and the question, with a
 * close button 'Cancel agent' on the right; one row per option with its number, label and
 * description (role radio, or checkbox for multi-select); the 'Other…' row numbered 0, with a tick
 * 'Select other response' on a multi-select question; then the dots and the 'Previous question' and
 * 'Next question' arrows when there is more than one question, and the Submit button with its key
 * in the tooltip.
 * Our design choice: A skipped question sends an empty list; the tool result says '(Skipped)' and
 * the history card masks a secret answer. A secret question has no option list, and its 'Other…'
 * row hides what is typed, as Conductor's does. Conductor's card has no group name and no option
 * preview, so ours has neither (D098); the group is named by its question. The card
 * asks sessions.answer once and stays disabled while the answer is sent; if that fails it says
 * 'Could not send answers. Try again.' and lets the user send again. A failed Cancel agent says
 * 'Could not cancel the agent. Try again.'
 * Must handle: One question (no previous or next); up to four questions; a multi-select question
 * with nothing ticked (skipped, allowed); 'Other' text empty (not accepted as an answer); the
 * interaction is withdrawn while open (card disappears, typed text is lost on purpose); Cancel
 * agent calls sessions.cancel; the
 * user's rebinds of the chat-question commands on the Keyboard shortcuts page (the card looks each
 * key up in the command registry, so "Pick an answer option by number" uses its n-th shortcut for
 * option n), and the send-key setting, which moves Submit to Cmd+Enter.
 * Test first: Choosing option 2 on a single-select question and pressing Enter calls
 * sessions.answer with answers [['<label 2>']].
 */

import type { Interaction } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { type KeyboardEvent, type ReactNode, useCallback, useId, useRef, useState } from "react";
import { fieldOwnsKey, keyPressOf, useScopedKeyMatch } from "../../../app/command-dispatcher.ts";
import { useActions, useLiveShortcut } from "../../../core/hooks.ts";
import { Checkbox } from "../../../ui/Checkbox.tsx";
import { cn } from "../../../ui/cn.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CheckIcon,
	CloseIcon,
} from "../../../ui/icons.tsx";
import { toast } from "../../../ui/Toast.tsx";
import { withKeys } from "../tools/ToolCardFrame.tsx";

export interface QuestionCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	questions: Extract<Interaction, { kind: "question" }>["questions"];
}

const ROW = "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left transition-colors";

export function QuestionCard({ sessionId, interactionId, questions }: QuestionCardProps) {
	const actions = useActions();
	const [page, setPage] = useState(0);
	const [chosen, setChosen] = useState<string[][]>(() => questions.map(() => []));
	const [otherTexts, setOtherTexts] = useState<string[]>(() => questions.map(() => ""));
	const [secretAnswers, setSecretAnswers] = useState<string[]>(() => questions.map(() => ""));
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState<"answer" | "cancel" | null>(null);
	const otherRefs = useRef<Array<HTMLInputElement | null>>([]);
	const questionId = useId();
	const matchKey = useScopedKeyMatch("chat-question");
	const submitKey = useLiveShortcut("chat.question.submit");
	const busy = useRef(false);
	const secretFocused = useRef<number | null>(null);
	/** Focuses a control when it mounts, so the wizard takes the keys as it opens. */
	const focusOnMount = useCallback((node: HTMLElement | null) => {
		node?.focus();
	}, []);

	const current = questions[page];

	function goToPage(next: number): void {
		setPage(Math.max(0, Math.min(questions.length - 1, next)));
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
			toast.error("Could not send answers. Try again.");
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
		const press = keyPressOf(event.nativeEvent);
		// A field keeps its own typing, whatever the user bound the card's commands to.
		if (typing && fieldOwnsKey(press, target)) return;
		const match = matchKey(press);
		if (match === null) return;

		if (match.commandId === "chat.question.submit") {
			const button = target.closest("button");
			if (button !== null && !button.hasAttribute("data-question-option")) return;
			event.preventDefault();
			void submit();
			return;
		}
		if (typing) return;

		if (match.commandId === "chat.question.previous") {
			event.preventDefault();
			goToPage(page - 1);
			return;
		}
		if (match.commandId === "chat.question.next") {
			event.preventDefault();
			goToPage(page + 1);
			return;
		}
		if (match.commandId === "chat.question.focusOther") {
			event.preventDefault();
			otherRefs.current[page]?.focus();
			return;
		}
		if (match.commandId === "chat.question.selectOption") {
			const option = current?.options[match.index];
			if (option === undefined) return;
			event.preventDefault();
			toggleOption(page, match.index);
		}
	}

	if (current === undefined) return null;

	const picked = chosen[page] ?? [];
	const otherText = (current.secret ? secretAnswers[page] : otherTexts[page]) ?? "";
	const otherFilled = otherText.trim().length > 0;

	function typeInOther(text: string): void {
		if (current?.secret) {
			setSecretAnswers((answers) => answers.map((value, index) => (index === page ? text : value)));
			return;
		}
		typeOther(page, text);
	}

	return (
		<fieldset
			aria-labelledby={questionId}
			onKeyDown={onKeyDown}
			className="m-0 w-full rounded-2xl border border-border bg-canvas px-3 py-3"
		>
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					{current.header ? (
						<div className="mb-1 text-xs text-fg-muted">{current.header}</div>
					) : null}
					<p id={questionId} className="max-h-[45vh] overflow-y-auto text-sm text-fg">
						{current.question}
					</p>
				</div>
				<IconButton
					label="Cancel agent"
					icon={<CloseIcon className="size-4" />}
					size="xs"
					className="text-fg-muted hover:text-fg"
					onClick={() => void cancelAgent()}
					disabled={pending}
				/>
			</div>

			<div className="mt-3 flex flex-col gap-0.5">
				{current.secret
					? null
					: withKeys(current.options, (option) => option.label, "option").map(
							({ key, item: option }, optionIndex) => {
								const selected = picked.includes(option.label);
								return (
									// biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is radio or checkbox, and both take aria-checked.
									<button
										key={key}
										ref={optionIndex === 0 ? focusOnMount : undefined}
										type="button"
										role={current.multiSelect ? "checkbox" : "radio"}
										aria-checked={selected}
										data-question-option={optionIndex}
										onClick={() => toggleOption(page, optionIndex)}
										className={cn(ROW, selected ? "bg-well" : "hover:bg-hover")}
									>
										<span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-xs text-fg-muted">
											{optionIndex + 1}
										</span>
										<span className="min-w-0 flex-1">
											<span className="text-sm text-fg">{option.label}</span>
											{option.description ? (
												<span className="mt-0.5 block text-xs text-fg-muted">
													{option.description}
												</span>
											) : null}
										</span>
										{current.multiSelect && selected ? (
											<CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
										) : null}
									</button>
								);
							},
						)}
				<div className={cn(ROW, otherFilled && "bg-well")}>
					<span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-xs text-fg-muted">
						0
					</span>
					<input
						ref={(node) => {
							otherRefs.current[page] = node;
							// A secret page takes the keys once, when it first shows; a later render leaves focus alone.
							if (current.secret && node !== null && secretFocused.current !== page) {
								secretFocused.current = page;
								node.focus();
							}
						}}
						type={current.secret ? "password" : "text"}
						aria-label="Other response"
						autoCapitalize="off"
						autoComplete="off"
						autoCorrect="off"
						spellCheck={false}
						placeholder="Other…"
						value={otherText}
						onChange={(event) => typeInOther(event.target.value)}
						className={cn(
							"min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-fg outline-none placeholder:text-fg-muted",
							current.secret && "font-mono tracking-widest",
						)}
					/>
					{current.multiSelect && !current.secret ? (
						<Checkbox
							aria-label="Select other response"
							checked={otherFilled}
							onCheckedChange={() => {
								if (otherFilled) typeInOther("");
							}}
						/>
					) : null}
				</div>
			</div>

			{failed !== null ? (
				<p role="alert" className="mt-2 text-xs text-danger">
					{failed === "answer"
						? "Could not send answers. Try again."
						: "Could not cancel the agent. Try again."}
				</p>
			) : null}

			<div className="mt-3 flex items-center justify-between">
				{questions.length > 1 ? (
					<div className="flex items-center gap-1.5">
						<PageArrow
							label="Previous question"
							disabled={page === 0}
							onClick={() => goToPage(page - 1)}
						>
							<ArrowLeftIcon className="size-3" />
						</PageArrow>
						{questions.map((_, index) => (
							<button
								// biome-ignore lint/suspicious/noArrayIndexKey: one dot per question, in order; the index is its identity.
								key={index}
								type="button"
								aria-label={`Question ${index + 1}`}
								onClick={() => goToPage(index)}
								className={cn(
									"size-2 rounded-full transition-colors hover:opacity-70",
									answersFor(index).length > 0 ? "bg-fg" : "border border-fg-muted bg-transparent",
									index === page && "ring-1 ring-border-strong ring-offset-1 ring-offset-canvas",
								)}
							/>
						))}
						<PageArrow
							label="Next question"
							disabled={page === questions.length - 1}
							onClick={() => goToPage(page + 1)}
						>
							<ArrowRightIcon className="size-3" />
						</PageArrow>
					</div>
				) : (
					<div />
				)}
				<IconButton
					label="Submit"
					icon={<ArrowUpIcon className="size-4" />}
					shortcut={submitKey ?? undefined}
					variant="default"
					size="xs"
					onClick={() => void submit()}
					loading={pending}
				/>
			</div>
		</fieldset>
	);
}

/** Conductor's small previous and next arrows. */
function PageArrow({
	label,
	disabled,
	onClick,
	children,
}: {
	label: string;
	disabled: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className="text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
		>
			{children}
		</button>
	);
}
