/**
 * @feature CHAT-12 Plan review bar
 * Owns: The bar that shows the agent's plan and lets the user approve it, hand it to a chat, copy
 * it, or reject it with feedback.
 * Behaviour: ui-map.md 3.3 (Plan approval: bar with 'Sending to <chat>' picker, 'Copy', 'Hand off'
 * (tooltip 'Send plan to a new chat for implementation'), 'Approve' (Cmd+Shift+Enter, tooltip
 * 'Execute plan in current chat'); a feedback box can reject the plan; sidebar text 'Review plan'),
 * claude-runner.md 3.5.
 * Our design choice: 'Approve' is the one primary button. 'Hand off' calls
 * useActions().sessions.startFromPlan(sessionId, planText, target), where target is the chat picked
 * in 'Sending to <chat>', or null for a new chat. After a hand-off this chat's plan is answered as
 * not approved, with no feedback, so its agent stops waiting (claude-runner 3.5: a cancelled plan
 * review is a plain denial). Approving first turns the chat's stored plan mode off and only then
 * answers, so a turn that starts right after the approval cannot run on the old plan-mode config.
 * Cmd+Shift+Enter rejects with the typed feedback when the box has text, and approves when it is
 * empty. The shortcut is a chat-card command, so Approve takes focus when the bar opens, as the
 * question card does.
 * Must handle: Very long plan (scrolls, collapsed to a few lines with 'Show all'); feedback empty
 * (Reject disabled); plan file path present (a link to open the file); the interaction is
 * withdrawn; Approve sets plan mode off before it answers, and a failed config write keeps the bar
 * open with the error; a hand-off whose closing answer fails says so.
 * Test first: Approve calls sessions.answer with kind plan_approval and approved true; Reject sends
 * the feedback text.
 */

import type { Interaction, InteractionAnswer, SessionConfig } from "@conducted/protocol";
import { type InteractionId, ok, type Result, type SessionId } from "@conducted/shared";
import { useCallback, useRef, useState } from "react";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import { useActions, useChat, useLiveShortcut, useSessions } from "../../../core/hooks.ts";
import type { Session } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { CopyButton } from "../../../ui/CopyButton.tsx";
import { Label, Textarea } from "../../../ui/Input.tsx";
import { Select } from "../../../ui/Select.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";
import { FileLink, textLines } from "../tools/ToolCardFrame.tsx";

export interface PlanReviewBarProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "plan_approval" }>;
}

type PlanAnswer = Extract<InteractionAnswer, { kind: "plan_approval" }>;

/** How many plan lines show before 'Show all'. */
const COLLAPSED_LINES = 12;

const NEW_CHAT = "new";

function chatName(session: Session): string {
	const title = session.title?.trim();
	return title === undefined || title.length === 0 ? "Untitled chat" : title;
}

export function PlanReviewBar({ sessionId, interactionId, request }: PlanReviewBarProps) {
	const chat = useChat(sessionId);
	if (chat.state !== "ready") return null;
	const session = chat.data.session;
	return (
		<PlanReviewForm
			sessionId={sessionId}
			interactionId={interactionId}
			request={request}
			session={session}
		/>
	);
}

function PlanReviewForm({
	sessionId,
	interactionId,
	request,
	session,
}: PlanReviewBarProps & { session: Session }) {
	const actions = useActions();
	const listed = useSessions(session.workspaceId);
	const [feedback, setFeedback] = useState("");
	const [showAll, setShowAll] = useState(false);
	const [target, setTarget] = useState<string>(NEW_CHAT);
	const [pending, setPending] = useState<"approve" | "reject" | "handOff" | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [chosen, setChosen] = useState<string | null>(null);
	const busy = useRef(false);
	/** Approve takes focus when the bar opens, so Cmd+Shift+Enter reaches the bar's handler. */
	const focusOnMount = useCallback((node: HTMLButtonElement | null) => {
		node?.focus();
	}, []);
	const approveShortcut = useLiveShortcut("chat.approvePlan");
	const lines = textLines(request.plan);
	const shownText = showAll ? request.plan : lines.slice(0, COLLAPSED_LINES).join("\n");
	const hasMore = lines.length > COLLAPSED_LINES;

	const chats =
		listed.state === "ready"
			? listed.data.filter((chat) => chat.id !== sessionId && chat.closedAt === null)
			: [];
	const options = [
		{ value: NEW_CHAT, label: "New chat" },
		...chats.map((chat) => ({ value: chat.id, label: chatName(chat) })),
	];

	async function answer(value: PlanAnswer): Promise<void> {
		if (busy.current || chosen !== null) return;
		busy.current = true;
		setPending(value.approved ? "approve" : "reject");
		setFailure(null);
		if (value.approved) {
			const left = await leavePlanMode();
			if (!left.ok) {
				busy.current = false;
				setPending(null);
				setFailure(`Couldn't turn plan mode off: ${left.error.message}`);
				return;
			}
		}
		const result = await actions.sessions.answer(sessionId, interactionId, value);
		if (!result.ok) {
			busy.current = false;
			setPending(null);
			setFailure(`Could not send the plan: ${result.error.message}`);
			return;
		}
		busy.current = false;
		setPending(null);
		setChosen(value.approved ? "Approved" : "Sent the feedback to the agent");
	}

	/** Turns the chat's stored plan mode off, so the next turn carries out the plan. */
	async function leavePlanMode(): Promise<Result<void>> {
		const current: SessionConfig = session.config;
		if (!current.planMode) return ok(undefined);
		return actions.sessions.updateConfig(sessionId, { ...current, planMode: false });
	}

	async function handOff(): Promise<void> {
		if (busy.current || chosen !== null) return;
		busy.current = true;
		setPending("handOff");
		setFailure(null);
		const targetId = target === NEW_CHAT ? null : (target as SessionId);
		const result = await actions.sessions.startFromPlan(sessionId, request.plan, targetId);
		if (!result.ok) {
			busy.current = false;
			setPending(null);
			setFailure(`Could not send the plan: ${result.error.message}`);
			return;
		}
		setChosen(targetId === null ? "Sent to a new chat" : `Sent to ${chatName(result.value)}`);
		// This chat's agent still waits on the plan. A denial with no feedback ends that wait.
		const closed = await actions.sessions.answer(sessionId, interactionId, {
			kind: "plan_approval",
			approved: false,
		});
		busy.current = false;
		setPending(null);
		if (!closed.ok) {
			setFailure(`The plan was sent, but this chat still waits on it: ${closed.error.message}`);
		}
	}

	function submitFeedback(): void {
		const text = feedback.trim();
		if (text.length === 0) return;
		void answer({ kind: "plan_approval", approved: false, feedback: text });
	}

	function submitShortcut(): boolean {
		if (busy.current || chosen !== null) return false;
		const text = feedback.trim();
		if (text.length > 0) {
			void answer({ kind: "plan_approval", approved: false, feedback: text });
			return true;
		}
		void answer({ kind: "plan_approval", approved: true });
		return true;
	}

	useCommandHandler("chat.approvePlan", "area", submitShortcut);

	const disabled = pending !== null || chosen !== null;

	return (
		<fieldset
			aria-label="Plan review"
			data-command-scope="chat-card"
			className="m-0 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
		>
			<div className="flex items-center justify-between gap-2">
				<p className="text-sm font-medium text-fg">Review plan</p>
				{request.planFilePath === undefined ? null : (
					<FileLink path={request.planFilePath}>Open plan file</FileLink>
				)}
			</div>

			<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-2 font-mono text-code text-fg">
				{shownText}
			</pre>
			{hasMore ? (
				<button
					type="button"
					onClick={() => setShowAll(!showAll)}
					className="self-start text-xs font-medium text-link hover:underline"
				>
					{showAll ? "Show less" : `Show all ${lines.length} lines`}
				</button>
			) : null}

			<div className="flex flex-wrap items-center gap-3">
				<label className="flex items-center gap-2 text-xs text-fg-muted" htmlFor="plan-target">
					Sending to
				</label>
				<Select
					id="plan-target"
					aria-label="Sending to"
					value={target}
					options={options}
					onValueChange={setTarget}
					disabled={disabled}
					size="sm"
				/>
				<CopyButton text={request.plan} onCopy={(text) => actions.app.copyText(text)} />
			</div>

			<div className="flex flex-col gap-1">
				<Label htmlFor="plan-feedback" className="text-xs font-medium text-fg-muted">
					Tell the agent what to change
				</Label>
				<Textarea
					id="plan-feedback"
					aria-label="Plan feedback"
					placeholder="Explain what the plan should do instead"
					value={feedback}
					onChange={(event) => setFeedback(event.target.value)}
					disabled={disabled}
					className="min-h-[60px]"
				/>
			</div>

			{failure === null ? null : (
				<p role="alert" className="text-xs text-danger">
					{failure}
				</p>
			)}

			{chosen === null ? (
				<>
					<p className="text-xs text-fg-subtle">
						Approve runs the plan in this chat. Hand off sends it to the chat above.
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Tooltip content="Execute plan in current chat" shortcut={approveShortcut ?? undefined}>
							<Button
								ref={focusOnMount}
								onClick={() => void answer({ kind: "plan_approval", approved: true })}
								loading={pending === "approve"}
								disabled={disabled}
							>
								Approve
							</Button>
						</Tooltip>
						<Tooltip content="Send plan to a new chat for implementation">
							<Button
								variant="secondary"
								onClick={() => void handOff()}
								loading={pending === "handOff"}
								disabled={disabled}
							>
								Hand off
							</Button>
						</Tooltip>
						<Button
							variant="outline"
							onClick={submitFeedback}
							loading={pending === "reject"}
							disabled={disabled || feedback.trim().length === 0}
						>
							Reject plan
						</Button>
					</div>
				</>
			) : (
				<p role="status" className="text-sm font-medium text-fg">
					{chosen}
				</p>
			)}
		</fieldset>
	);
}
