/**
 * @feature CHAT-12 Plan review bar
 * Owns: The bar that shows the agent's plan and lets the user approve it, hand it to a chat or
 * copy it. Feedback that rejects the plan is typed in the composer (COMP-01), as in Conductor.
 * Behaviour: ui-map.md 3.3 (Plan approval: bar with 'Sending to <chat>' picker, 'Copy', 'Hand off'
 * (tooltip 'Send plan to a new chat for implementation'), 'Approve' (Cmd+Shift+Enter, tooltip
 * 'Execute plan in current chat'); a feedback box can reject the plan; sidebar text 'Review plan'),
 * claude-runner.md 3.5.
 * Structure (Conductor's plan bar, renderApp @9259644): one row of small buttons on the right:
 * 'Copy' (tooltip 'Copy plan to clipboard'), 'Hand off' (tooltip 'Send plan to a new chat for
 * implementation') and 'Approve' with its live key (tooltip 'Execute plan in current chat').
 * Conductor takes plan feedback in the composer, whose placeholder then reads 'Enter your plan
 * adjustments here...' (renderApp @9294541); sending it answers the plan as not approved. The bar
 * has no feedback box or reject button (D098). The plan text, 'Show all' and the plan file link
 * are ours: Conductor shows the plan in the chat's tool card.
 * Our design choice: 'Approve' is the one primary button. 'Hand off' calls
 * useActions().sessions.startFromPlan(sessionId, planText, target), where target is the chat picked
 * in 'Sending to <chat>', or null for a new chat. After a hand-off this chat's plan is answered as
 * not approved, with no feedback, so its agent stops waiting (claude-runner 3.5: a cancelled plan
 * review is a plain denial). Approving first turns the chat's stored plan mode off and only then
 * answers, so a turn that starts right after the approval cannot run on the old plan-mode config.
 * Cmd+Shift+Enter approves. The shortcut is a chat-card command, so Approve takes focus when the
 * bar opens, as the question card does.
 * Must handle: Very long plan (scrolls, collapsed to a few lines with 'Show all'); plan file path
 * present (a link to open the file); the interaction is
 * withdrawn; Approve sets plan mode off before it answers, and a failed config write keeps the bar
 * open with the error; a hand-off whose closing answer fails says so.
 * Test first: Approve calls sessions.answer with kind plan_approval and approved true; text sent
 * from the composer while the plan waits is the feedback.
 */

import type { Interaction, InteractionAnswer, SessionConfig } from "@conducted/protocol";
import { type InteractionId, ok, type Result, type SessionId } from "@conducted/shared";
import { useCallback, useRef, useState } from "react";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import { useActions, useChat, useLiveShortcut, useSessions } from "../../../core/hooks.ts";
import type { Session } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { CopyButton } from "../../../ui/CopyButton.tsx";
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
	const [showAll, setShowAll] = useState(false);
	const [target, setTarget] = useState<string>(NEW_CHAT);
	const [pending, setPending] = useState<"approve" | "handOff" | null>(null);
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

	async function approve(): Promise<void> {
		if (busy.current || chosen !== null) return;
		busy.current = true;
		setPending("approve");
		setFailure(null);
		const left = await leavePlanMode();
		if (!left.ok) {
			busy.current = false;
			setPending(null);
			setFailure(`Couldn't turn plan mode off: ${left.error.message}`);
			return;
		}
		const approved: PlanAnswer = { kind: "plan_approval", approved: true };
		const result = await actions.sessions.answer(sessionId, interactionId, approved);
		if (!result.ok) {
			busy.current = false;
			setPending(null);
			setFailure(`Could not send the plan: ${result.error.message}`);
			return;
		}
		busy.current = false;
		setPending(null);
		setChosen("Approved");
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

	function submitShortcut(): boolean {
		if (busy.current || chosen !== null) return false;
		void approve();
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
			</div>

			{failure === null ? null : (
				<p role="alert" className="text-xs text-danger">
					{failure}
				</p>
			)}

			{chosen === null ? (
				<div className="flex flex-wrap items-center gap-2">
					<div className="ml-auto flex items-center gap-2">
						<Tooltip content="Copy plan to clipboard">
							<CopyButton
								text={request.plan}
								onCopy={(text) => actions.app.copyText(text)}
								size="xs"
								className="px-3"
							/>
						</Tooltip>
						<Tooltip content="Send plan to a new chat for implementation">
							<Button
								variant="ghost"
								size="xs"
								className="px-3"
								onClick={() => void handOff()}
								loading={pending === "handOff"}
								disabled={disabled}
							>
								Hand off
							</Button>
						</Tooltip>
						<Tooltip content="Execute plan in current chat">
							<Button
								ref={focusOnMount}
								size="xs"
								className="px-3"
								onClick={() => void approve()}
								loading={pending === "approve"}
								disabled={disabled}
							>
								Approve
								{approveShortcut === null ? null : (
									// The key glyphs are a visual hint. A screen reader hears only "Approve".
									<span aria-hidden="true" className="opacity-70">
										{approveShortcut}
									</span>
								)}
							</Button>
						</Tooltip>
					</div>
				</div>
			) : (
				<p role="status" className="text-sm font-medium text-fg">
					{chosen}
				</p>
			)}
		</fieldset>
	);
}
