/**
 * @feature CHAT-11 Tool approval card
 * Owns: The card that asks whether the agent may run a tool: what it wants to do, why, and the
 * buttons.
 * Behaviour: ui-map.md 3.3 (Approval card: title by tool such as 'Do you want to run this
 * command?', 'make these changes?', 'fetch this page?'; shows the tool card or the decision reason;
 * buttons 'Yes' (Enter), 'Allow all edits during this session' or 'Yes always' (Cmd+Enter), 'No'
 * (Backspace)), claude-runner.md 3.2.
 * Structure (Conductor's approval card, renderApp @8830523): the title with the 'Subagent' badge,
 * the tool card, then one column of full-width buttons, each with its live key on the right:
 * 'Yes', the second choice, any further choice, 'No'.
 * Our design choice: Our decisions are allow, allow_edits_for_session, allow_with_suggested_rules,
 * always_allow and deny (see the protocol). The buttons between Yes and No come from
 * approvalChoices in approval-tool.ts, which holds Conductor's labels and the ones we keep. The
 * card stays in the dock above the composer; Conductor draws it in place of the composer's text
 * box. Ours keeps the reason above the tool card, the suggested rules list, the blocked-path line
 * and the optional message on 'No', which Conductor's card does not show.
 * Must handle: A blocked path outside the workspace (shown with the path); shortcuts fire only
 * while the card or one of its controls has focus and never while the user types in any field; one
 * decision per card, then the card shows what was chosen. The card does not take focus when it
 * arrives, so a person typing a message keeps their place in the composer. The keys are the live
 * bindings of chat.approveTool, chat.approveToolAlternate and chat.denyTool, so a rebind on the
 * Keyboard shortcuts page reaches the card.
 * Test first: Pressing Enter on a bash approval calls sessions.answer with decision 'allow';
 * Backspace sends 'deny'.
 */

import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { type KeyboardEvent, useId, useState } from "react";
import { keyPressOf, useScopedKeyMatch } from "../../../app/command-dispatcher.ts";
import { useLiveShortcut } from "../../../core/hooks.ts";
import type { ToolCallView } from "../../../core/model.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { WrenchIcon } from "../../../ui/icons.tsx";
import { Kbd } from "../../../ui/Kbd.tsx";
import { ToolCard } from "../tools/ToolCard.tsx";
import { withKeys } from "../tools/ToolCardFrame.tsx";
import {
	type ApprovalChoice,
	approvalChoices,
	approvalTitle,
	canonicalToolForApproval,
} from "./approval-tool.ts";
import { useInteractionAnswer } from "./use-interaction-answer.ts";

export interface ToolApprovalCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "tool_approval" }>;
}

type Decision = Extract<InteractionAnswer, { kind: "tool_approval" }>["decision"];

export { approvalTitle } from "./approval-tool.ts";

const OUTCOME: Record<Decision, string> = {
	allow: "Allowed",
	allow_edits_for_session: "Allowed all edits for this session",
	allow_with_suggested_rules: "Allowed with the suggested rules",
	always_allow: "Always allowed",
	deny: "Denied",
};

export function ToolApprovalCard({ sessionId, interactionId, request }: ToolApprovalCardProps) {
	const [message, setMessage] = useState("");
	const messageId = useId();
	const matchKey = useScopedKeyMatch("chat-card");
	const answerState = useInteractionAnswer<Extract<InteractionAnswer, { kind: "tool_approval" }>>({
		sessionId,
		interactionId,
		labelFor: (answer) => OUTCOME[answer.decision],
		blocked: false,
	});

	const approveKey = useLiveShortcut("chat.approveTool");
	const alternateKey = useLiveShortcut("chat.approveToolAlternate");
	const denyKey = useLiveShortcut("chat.denyTool");
	const suggestedRules = request.suggestedRules ?? [];
	const choices = approvalChoices(request.toolName, suggestedRules);
	const alternateDecision: Decision = choices[0]?.decision ?? "always_allow";
	const rules = withKeys(suggestedRules, (rule) => rule, "rule");
	const pendingDecision = answerState.pending?.decision ?? null;
	const chosen = answerState.chosen;
	const toolCall: ToolCallView = {
		toolUseId: request.toolUseId,
		item: {
			kind: "tool_call",
			toolUseId: request.toolUseId,
			tool: canonicalToolForApproval(request.toolName),
			rawName: request.toolName,
			input: request.input,
		},
		result: null,
		children: [],
	};

	function send(decision: Decision): void {
		const text = message.trim();
		void answerState.answer({
			kind: "tool_approval",
			decision,
			...(decision === "deny" && text.length > 0 ? { message: text } : {}),
		});
	}

	function onKeyDown(event: KeyboardEvent<HTMLFieldSetElement>): void {
		if (chosen !== null) return;
		const target = event.target as HTMLElement;
		const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
		const onButton = target.closest("button") !== null;

		if (typing) return;
		const match = matchKey(keyPressOf(event.nativeEvent));
		if (match === null) return;
		if (match.commandId === "chat.approveToolAlternate") {
			event.preventDefault();
			send(alternateDecision);
			return;
		}
		if (onButton) return;
		if (match.commandId === "chat.approveTool") {
			event.preventDefault();
			send("allow");
			return;
		}
		if (match.commandId === "chat.denyTool") {
			event.preventDefault();
			send("deny");
		}
	}

	const disabled = pendingDecision !== null;

	return (
		<fieldset
			aria-label="Tool approval"
			onKeyDown={onKeyDown}
			className="m-0 flex flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-muted px-4 py-3"
		>
			<div className="flex items-center gap-2">
				<WrenchIcon className="size-4 shrink-0 text-fg-subtle" />
				<p className="text-sm font-medium text-fg">{approvalTitle(request.toolName)}</p>
				{request.subAgentId === undefined ? null : <Badge>Subagent</Badge>}
			</div>

			<div className="flex min-w-0 flex-col gap-2">
				{request.reason === undefined ? null : (
					<p className="text-sm text-fg-muted">{request.reason}</p>
				)}
				<ToolCard call={toolCall} sessionId={sessionId} />
			</div>

			{request.blockedPath === undefined ? null : (
				<p className="rounded-md border border-warning-border bg-warning-surface px-2 py-1.5 text-xs text-warning-fg">
					That path is outside this workspace:{" "}
					<span className="font-mono">{request.blockedPath}</span>
				</p>
			)}

			{rules.length === 0 ? null : (
				<div className="flex flex-col gap-1 text-xs text-fg-muted">
					<span className="font-medium text-fg">The agent suggests these rules:</span>
					<ul className="list-disc pl-4">
						{rules.map(({ key, item: rule }) => (
							<li key={key}>{rule}</li>
						))}
					</ul>
				</div>
			)}

			<div className="flex flex-col gap-1 text-xs text-fg-muted">
				<label htmlFor={messageId} className="text-xs font-medium text-fg-muted">
					Message to the agent (optional)
				</label>
				<Input
					id={messageId}
					aria-label="Message to the agent"
					placeholder="Why are you denying this?"
					value={message}
					onChange={(event) => setMessage(event.target.value)}
					disabled={pendingDecision !== null || chosen !== null}
				/>
			</div>

			{answerState.failed === null ? null : (
				<p role="alert" className="text-xs text-danger">
					Could not send the answer: {answerState.failed}
				</p>
			)}

			{chosen === null ? (
				<div className="flex flex-col items-stretch gap-2">
					<ChoiceButton
						label="Yes"
						shortcut={approveKey}
						onClick={() => send("allow")}
						loading={pendingDecision === "allow"}
						disabled={disabled}
					/>
					{choices.map((choice: ApprovalChoice, index) => (
						<ChoiceButton
							key={choice.decision}
							label={choice.label}
							shortcut={index === 0 ? alternateKey : null}
							onClick={() => send(choice.decision)}
							loading={pendingDecision === choice.decision}
							disabled={disabled}
						/>
					))}
					<ChoiceButton
						label="No"
						shortcut={denyKey}
						onClick={() => send("deny")}
						loading={pendingDecision === "deny"}
						disabled={disabled}
					/>
				</div>
			) : (
				<p role="status" className="text-sm font-medium text-fg">
					{chosen}
				</p>
			)}
		</fieldset>
	);
}

/** One full-width choice: its label on the left and its live key, when it has one, on the right. */
function ChoiceButton({
	label,
	shortcut,
	onClick,
	loading,
	disabled,
}: {
	label: string;
	shortcut: string | null;
	onClick: () => void;
	loading: boolean;
	disabled: boolean;
}) {
	return (
		<Button
			variant="outline"
			size="sm"
			className="h-9 overflow-hidden px-4 text-sm *:w-full *:justify-between"
			onClick={onClick}
			loading={loading}
			disabled={disabled}
		>
			<span className="truncate">{label}</span>
			{shortcut === null ? null : (
				// The key glyphs are a visual hint. A screen reader hears only the choice's name.
				<span aria-hidden="true">
					<Kbd>{shortcut}</Kbd>
				</span>
			)}
		</Button>
	);
}
