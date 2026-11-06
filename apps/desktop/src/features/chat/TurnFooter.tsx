/**
 * @feature CHAT-06 Turn footer; CHAT-16 Fork a chat from a turn
 * Owns: The footer under a finished turn: copy actions, token and time details and the fork and reset
 * menu. The files the turn changed are listed above it by TurnChanges.
 * Behaviour: ui-map.md 3.3 (Turn footer: 'Copy final message', 'Copy summary', hover card with
 * start and end time, Fast mode state and Input, Output, Cache read, Cache write tokens; More
 * menu: 'Fork to new tab', 'Fork to new workspace', 'Reset chat', copy options).
 * Our design choice (CHAT-14): with the Experimental setting 'Show agent cost' on, the hover card
 * also shows the cost the agent reported for this turn. Conductor shows cost only for cloud runs.
 * Fork to a new tab copies the chat up to this turn and opens the new chat (CHAT-16). It is always
 * in this menu: the Experimental setting 'Fork chat to new tab' gates only the chat tab menu item
 * and Cmd+Alt+Enter, as its text says (ui-map.md 3.3 lists the turn menu's fork without it, 6 names
 * the tab menu and the shortcut). Fork to a new workspace is CHAT-21 and stays disabled until it
 * is built.
 * Must handle: A running turn (no footer, TurnItem shows the spinner instead); no usage reported (the hover card
 * says so); an agent that does not report fast mode or cost (that line is left out); no checkpoint (Fork and Reset disabled with a reason); a cancelled or errored turn (footer still
 * copies); a copy or fork that fails (a toast, "Unable to fork chat" when the turn has no checkpoint);
 * Reset opens the confirmation dialog instead of changing anything at once. The More menu repeats
 * the copy actions; the row wraps at a narrow width instead of collapsing into the menu.
 * Test first: A finished turn with usage shows token counts in the hover card; without a checkpoint
 * Reset is disabled.
 */

import type { SessionId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions, useSetting } from "../../core/hooks.ts";
import type { ChatTurn } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { ChevronDownIcon, ClockIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { formatCost } from "./ContextWheel.tsx";
import { ResetChatDialog } from "./ResetChatDialog.tsx";
import { reportFailure } from "./report-failure.ts";

export interface TurnFooterProps {
	turn: ChatTurn;
	sessionId: SessionId;
}

function clock(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function finalMessageOf(turn: ChatTurn): string {
	return turn.blocks
		.flatMap((block) => (block.kind === "text" ? [block.text] : []))
		.join("\n\n")
		.trim();
}

function summaryOf(turn: ChatTurn, finalMessage: string): string {
	const lines = [`User: ${turn.userMessage?.text ?? "(the agent started this turn)"}`];
	if (finalMessage.length > 0) lines.push(`Assistant: ${finalMessage}`);
	lines.push(`Outcome: ${turn.outcome}`);
	if (turn.usage !== null) {
		lines.push(
			`Tokens: input ${turn.usage.inputTokens}, output ${turn.usage.outputTokens}, cache read ${turn.usage.cacheReadTokens}, cache write ${turn.usage.cacheWriteTokens}`,
		);
	}
	if (turn.changes.length > 0) {
		lines.push(`Files changed: ${turn.changes.length}`);
	}
	return lines.join("\n");
}

function detailsOf(turn: ChatTurn, showCost: boolean): string {
	const end = turn.endedAt === null ? "running" : clock(turn.endedAt);
	const lines = [`${clock(turn.startedAt)} to ${end}`];
	const usage = turn.usage;
	if (usage === null) {
		lines.push("No usage reported.");
		return lines.join("\n");
	}
	if (usage.fastMode !== null) lines.push(`Fast mode ${usage.fastMode ? "on" : "off"}`);
	lines.push(
		`Input ${usage.inputTokens} · Output ${usage.outputTokens} · Cache read ${usage.cacheReadTokens} · Cache write ${usage.cacheWriteTokens}`,
	);
	if (showCost && usage.costUsd !== null) lines.push(`Cost ${formatCost(usage.costUsd)}`);
	return lines.join("\n");
}

export function TurnFooter({ turn, sessionId }: TurnFooterProps) {
	const actions = useActions();
	const navigate = useNavigate();
	const showCost = useSetting<boolean>("experimental_show_agent_cost") === true;
	const [resetOpen, setResetOpen] = useState(false);
	const forkFlight = useRef(createSingleFlight()).current;
	const finalMessage = finalMessageOf(turn);
	const summary = summaryOf(turn, finalMessage);
	const canReset = turn.startCheckpointId !== null;
	const canFork = turn.endCheckpointId !== null || canReset;
	const copy = (text: string) => actions.app.copyText(text);
	const copyFromMenu = (text: string) => {
		void reportFailure(copy(text), "Couldn't copy the text");
	};
	const fork = () => {
		void forkFlight.run(`chat:${sessionId}:fork:${turn.turnId}`, async () => {
			const result = await actions.sessions.forkFrom(sessionId, turn.turnId);
			if (!result.ok) {
				toastError("Unable to fork chat", result.error);
				return;
			}
			void navigate({
				search: ((previous: Record<string, unknown>) => ({
					...previous,
					tab: "session",
					sessionId: result.value.id,
				})) as never,
			});
		});
	};

	return (
		<div className="flex flex-wrap items-center gap-1 text-2xs text-fg-subtle">
			<CopyButton
				text={finalMessage}
				onCopy={copy}
				label="Copy final message"
				size="xs"
				disabled={finalMessage.length === 0}
			/>
			<CopyButton text={summary} onCopy={copy} label="Copy summary" size="xs" />
			<Tooltip content={detailsOf(turn, showCost)}>
				<Button variant="ghost" size="xs" aria-label="Turn details" className="gap-1">
					<ClockIcon />
					<span>{clock(turn.startedAt)}</span>
				</Button>
			</Tooltip>
			<Menu>
				<MenuTrigger asChild>
					<Button variant="ghost" size="xs" aria-label="More turn actions">
						<ChevronDownIcon />
					</Button>
				</MenuTrigger>
				<MenuContent>
					<MenuItem
						disabled={!canFork}
						title={canFork ? undefined : "This turn has no checkpoint to fork from."}
						onSelect={fork}
					>
						Fork to new tab
					</MenuItem>
					<MenuItem disabled title="Fork to a new workspace is built by CHAT-21.">
						Fork to new workspace
					</MenuItem>
					<MenuItem
						disabled={!canReset}
						title={canReset ? undefined : "This turn has no checkpoint to reset to."}
						onSelect={() => setResetOpen(true)}
					>
						Reset chat
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						disabled={finalMessage.length === 0}
						onSelect={() => copyFromMenu(finalMessage)}
					>
						Copy final message
					</MenuItem>
					<MenuItem onSelect={() => copyFromMenu(summary)}>Copy summary</MenuItem>
				</MenuContent>
			</Menu>
			<ResetChatDialog
				open={resetOpen}
				onOpenChange={setResetOpen}
				sessionId={sessionId}
				turnId={turn.turnId}
				busy={turn.outcome === "running"}
			/>
		</div>
	);
}
