/**
 * @feature CHAT-12 Plan review bar
 * Owns: The bar that lets the user approve the agent's plan, hand it to a chat or copy it. The
 * plan's text is the chat's plan card (tools/cards/ExitPlanModeCard.tsx), as in Conductor. Feedback that rejects the plan is typed in the composer (COMP-01), as in Conductor.
 * Behaviour: ui-map.md 3.3 (Plan approval: bar with 'Sending to <chat>' picker, 'Copy', 'Hand off'
 * (tooltip 'Send plan to a new chat for implementation'), 'Approve' (Cmd+Shift+Enter, tooltip
 * 'Execute plan in current chat'); a feedback box can reject the plan; sidebar text 'Review plan'),
 * claude-runner.md 3.5.
 * Structure (Conductor's plan bar, renderApp @9259644): one row of small buttons on the right:
 * 'Copy' (tooltip 'Copy plan to clipboard'), 'Hand off' (tooltip 'Send plan to a new chat for
 * implementation') and 'Approve' with its live key (tooltip 'Execute plan in current chat').
 * Conductor takes plan feedback in the composer, whose placeholder then reads 'Enter your plan
 * adjustments here...' (renderApp @9294541); sending it answers the plan as not approved. The bar
 * has no feedback box or reject button, and no title or plan text (D098): Conductor shows the
 * plan in the chat's tool card. The plan file link is ours and sits at the start of the row.
 * Our design choice: 'Approve' is the one primary button. 'Hand off' calls
 * useActions().sessions.startFromPlan(sessionId, planText, target), where target is the chat picked
 * in 'Sending to <chat>', or null for a new chat. After a hand-off this chat's plan is answered as
 * not approved, with no feedback, so its agent stops waiting (claude-runner 3.5: a cancelled plan
 * review is a plain denial). Approving first turns the chat's stored plan mode off and only then
 * answers, so a turn that starts right after the approval cannot run on the old plan-mode config.
 * Cmd+Shift+Enter approves wherever focus is, as in Conductor, whose chat pane registers the
 * shortcut beside the composer's commands (renderApp @9295505). Focus stays in the composer. The
 * composer handles the key first and sends its text as the plan's adjustments when it holds any
 * (renderApp @9313268); with an empty composer the key reaches this bar. Only the chat on screen
 * takes it, so a second chat beside it in a split pane keeps its plan.
 * Must handle: plan file path present (a link to open the file); the interaction is
 * withdrawn; Approve sets plan mode off before it answers, and a failed config write keeps the bar
 * open with the error; a hand-off whose closing answer fails says so.
 * Test first: Approve calls sessions.answer with kind plan_approval and approved true; text sent
 * from the composer while the plan waits is the feedback.
 */

import type { Interaction, InteractionAnswer, SessionConfig } from "@conducted/protocol";
import { type InteractionId, ok, type Result, type SessionId } from "@conducted/shared";
import { useRef, useState } from "react";
import { useCommandHandler } from "../../../app/command-dispatcher.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions, useChat, useLiveShortcut, useSessions } from "../../../core/hooks.ts";
import type { Session } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { CopyButton } from "../../../ui/CopyButton.tsx";
import { Select } from "../../../ui/Select.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";
import { FileLink } from "../tools/ToolCardFrame.tsx";

export interface PlanReviewBarProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "plan_approval" }>;
}

type PlanAnswer = Extract<InteractionAnswer, { kind: "plan_approval" }>;

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
	const { services } = useServices();
	const listed = useSessions(session.workspaceId);
	const [target, setTarget] = useState<string>(NEW_CHAT);
	const [pending, setPending] = useState<"approve" | "handOff" | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [chosen, setChosen] = useState<string | null>(null);
	const busy = useRef(false);
	const approveShortcut = useLiveShortcut("chat.approvePlan");

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
		if (services.sessions.store.getState().viewingSessionId !== sessionId) return false;
		if (busy.current || chosen !== null) return false;
		void approve();
		return true;
	}

	// Below the composer's handler (area), which takes the key when it holds plan adjustments.
	useCommandHandler("chat.approvePlan", "base", submitShortcut);

	const disabled = pending !== null || chosen !== null;

	return (
		<fieldset
			aria-label="Plan review"
			className="m-0 flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-2"
		>
			<div className="flex flex-wrap items-center gap-3">
				{request.planFilePath === undefined ? null : (
					<FileLink path={request.planFilePath}>Open plan file</FileLink>
				)}
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
