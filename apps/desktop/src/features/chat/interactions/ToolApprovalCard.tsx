/**
 * @feature CHAT-11 Tool approval card
 * Owns: The card that asks whether the agent may run a tool: what it wants to do, why, and the
 * buttons.
 * Behaviour: ui-map.md 3.3 (Approval card: title by tool such as 'Do you want to run this
 * command?', 'make these changes?', 'fetch this page?'; shows the tool card or the decision reason;
 * buttons 'Yes' (Enter), 'Allow all edits during this session' or 'Yes always' (Cmd+Enter), 'No'
 * (Backspace)), claude-runner.md 3.2.
 * Our design choice: Our decisions are allow, allow_edits_for_session, allow_with_suggested_rules,
 * always_allow and deny (see the protocol). The secondary button label depends on the tool: edits
 * offer 'Allow all edits during this session', other tools offer 'Yes always'. A third button
 * allows with the rules the agent suggests, shown only when the request has `suggestedRules`. A
 * request from a sub-agent (`subAgentId`) shows a 'Subagent' badge. 'No' can carry a short message.
 * Must handle: A blocked path outside the workspace (shown with the path); the tool input is long
 * (collapsed with 'Show all'); keyboard shortcuts fire only while the card has focus and never
 * while the user types in the message field; one decision per card, then the card shows what was
 * chosen. The caller removes the card when the interaction is withdrawn.
 * Test first: Pressing Enter on a bash approval calls sessions.answer with decision 'allow';
 * Backspace sends 'deny'.
 */

import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { type KeyboardEvent, useCallback, useId, useRef, useState } from "react";
import { useActions } from "../../../core/hooks.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { WrenchIcon } from "../../../ui/icons.tsx";
import { formatJson, textField, withKeys } from "../tools/ToolCardFrame.tsx";

export interface ToolApprovalCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "tool_approval" }>;
}

type Decision = Extract<InteractionAnswer, { kind: "tool_approval" }>["decision"];

const EDIT_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit", "filechange", "patch"]);

/** True for the tools whose approval is about changing files. */
function editsFiles(toolName: string): boolean {
	return EDIT_TOOLS.has(toolName.toLowerCase());
}

/** The approval title Conductor shows for each kind of tool (ui-map.md 3.3). */
export function approvalTitle(toolName: string): string {
	const name = toolName.toLowerCase();
	if (name === "runlocalcommand") return "Do you want to run this command on your Mac?";
	if (
		name.includes("bash") ||
		name.includes("shell") ||
		name.includes("command") ||
		name === "exec"
	) {
		return "Do you want to run this command?";
	}
	if (editsFiles(toolName)) return "Do you want to make these changes?";
	if (name === "task" || name === "agent" || name.includes("subagent") || name === "sub_agent") {
		return "Do you want to run this agent?";
	}
	if (name.includes("websearch") || name.includes("web_search") || name === "search") {
		return "Do you want to do this search?";
	}
	if (name.includes("webfetch") || name.includes("web_fetch") || name.includes("fetch")) {
		return "Do you want to fetch this page?";
	}
	return "Do you want to run this tool?";
}

/** A one-line summary of the tool's input, when it names a command, path or address. */
function inputSummary(input: unknown): string | null {
	return textField(
		input,
		"command",
		"cmd",
		"file_path",
		"path",
		"url",
		"query",
		"pattern",
		"description",
		"prompt",
		"task",
		"name",
	);
}

const LONG_INPUT = 400;

const OUTCOME: Record<Decision, string> = {
	allow: "Allowed",
	allow_edits_for_session: "Allowed all edits for this session",
	allow_with_suggested_rules: "Allowed with the suggested rules",
	always_allow: "Always allowed",
	deny: "Denied",
};

export function ToolApprovalCard({ sessionId, interactionId, request }: ToolApprovalCardProps) {
	const actions = useActions();
	const [message, setMessage] = useState("");
	const [showAll, setShowAll] = useState(false);
	const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
	const [failed, setFailed] = useState(false);
	const [chosen, setChosen] = useState<Decision | null>(null);
	const messageId = useId();
	const busy = useRef(false);
	/** Focuses the card when it mounts, so its shortcuts work without a click. */
	const focusOnMount = useCallback((node: HTMLElement | null) => {
		node?.focus();
	}, []);

	const edits = editsFiles(request.toolName);
	const alternateDecision: Decision = edits ? "allow_edits_for_session" : "always_allow";
	const alternateLabel = edits ? "Allow all edits during this session" : "Yes always";
	const suggestedRules = request.suggestedRules ?? [];
	const inputText = formatJson(request.input);
	const summary = inputSummary(request.input);
	const truncated = inputText.length > LONG_INPUT && !showAll;
	const shownInput = truncated ? `${inputText.slice(0, LONG_INPUT)}…` : inputText;
	const rules = withKeys(suggestedRules, (rule) => rule, "rule");

	async function send(decision: Decision): Promise<void> {
		if (busy.current || chosen !== null) return;
		busy.current = true;
		setPendingDecision(decision);
		setFailed(false);
		const text = message.trim();
		const answer: Extract<InteractionAnswer, { kind: "tool_approval" }> = {
			kind: "tool_approval",
			decision,
			...(decision === "deny" && text.length > 0 ? { message: text } : {}),
		};
		const result = await actions.sessions.answer(sessionId, interactionId, answer);
		if (!result.ok) {
			busy.current = false;
			setPendingDecision(null);
			setFailed(true);
			return;
		}
		setChosen(decision);
		setPendingDecision(null);
	}

	function onKeyDown(event: KeyboardEvent<HTMLFieldSetElement>): void {
		if (event.nativeEvent.isComposing || chosen !== null) return;
		const target = event.target as HTMLElement;
		const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
		const onButton = target.closest("button") !== null;

		if (typing) return;
		if (event.metaKey && event.key === "Enter") {
			event.preventDefault();
			void send(alternateDecision);
			return;
		}
		if (onButton) return;
		if (event.key === "Enter") {
			event.preventDefault();
			void send("allow");
			return;
		}
		if (event.key === "Backspace") {
			event.preventDefault();
			void send("deny");
		}
	}

	return (
		<fieldset
			aria-label="Tool approval"
			ref={focusOnMount}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			className="m-0 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
		>
			<div className="flex items-center gap-2">
				<WrenchIcon className="size-4 shrink-0 text-fg-subtle" />
				<p className="text-sm font-medium text-fg">{approvalTitle(request.toolName)}</p>
				{request.subAgentId === undefined ? null : <Badge>Subagent</Badge>}
			</div>

			{request.reason === undefined ? null : (
				<p className="text-sm text-fg-muted">{request.reason}</p>
			)}

			<div className="flex flex-col gap-2 rounded-md border border-border bg-canvas p-2">
				<div className="flex items-baseline gap-2">
					<span className="text-xs font-medium text-fg">{request.toolName}</span>
					{summary === null ? null : (
						<span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
							{summary}
						</span>
					)}
				</div>
				<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-surface p-2 font-mono text-xs text-fg-muted">
					{shownInput}
				</pre>
				{inputText.length > LONG_INPUT ? (
					<button
						type="button"
						onClick={() => setShowAll(!showAll)}
						className="self-start text-xs font-medium text-fg-muted hover:text-fg"
					>
						{showAll ? "Show less" : "Show all"}
					</button>
				) : null}
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

			{failed ? (
				<p role="alert" className="text-xs text-danger">
					Could not send the answer. Try again.
				</p>
			) : null}

			{chosen === null ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={() => void send("allow")}
						loading={pendingDecision === "allow"}
						disabled={pendingDecision !== null}
					>
						Yes
					</Button>
					<Button
						variant="secondary"
						onClick={() => void send(alternateDecision)}
						loading={pendingDecision === alternateDecision}
						disabled={pendingDecision !== null}
					>
						{alternateLabel}
					</Button>
					{suggestedRules.length === 0 ? null : (
						<Button
							variant="outline"
							onClick={() => void send("allow_with_suggested_rules")}
							loading={pendingDecision === "allow_with_suggested_rules"}
							disabled={pendingDecision !== null}
						>
							Allow with suggested rules
						</Button>
					)}
					<Button
						variant="outline"
						onClick={() => void send("deny")}
						loading={pendingDecision === "deny"}
						disabled={pendingDecision !== null}
					>
						No
					</Button>
				</div>
			) : (
				<p role="status" className="text-sm font-medium text-fg">
					{OUTCOME[chosen]}
				</p>
			)}
		</fieldset>
	);
}
