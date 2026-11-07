/**
 * @feature CHAT-06 Turn footer; CHAT-16 Fork a chat from a turn; CHAT-21 Fork a chat to a new
 * workspace
 * Owns: The footer row under a finished turn: how long the turn took and when it ended (with the token and
 * time details on hover), a copy icon, the "···" menu with fork, reset and copy actions, then the files the
 * turn changed (TurnChanges).
 * Behaviour: ui-map.md 3.3 (Turn footer: 'Copy final message', hover card with start and end time, Fast
 * mode state and Input, Output, Cache read, Cache write tokens; More menu: 'Fork to new tab', 'Fork to new
 * workspace', 'Reset chat', copy options). Measured from Conductor 0.92.1 (renderApp @9582374): one
 * wrapping row of text-xs muted text, 8px gaps, 2px above; "3s · 5:20 pm" first (duration without tenths,
 * then the end time: the time alone today, the weekday within a week, else the date), then a 20px copy
 * icon button, then a 20px "···" button, then the file chips.
 * Our design choice: "Copy summary" is ours (Conductor's "Copy summary" belongs to compacted history); it
 * sits in the "···" menu next to "Copy final message". "Open diff" (REV-09, ours) is in the same menu,
 * after them, for a turn that changed files, so the row itself is Conductor's (D098). Our design choice (CHAT-14): with the Experimental setting 'Show agent cost' on, the hover card
 * also shows the cost the agent reported for this turn. Conductor shows cost only for cloud runs.
 * Fork to a new tab copies the chat up to this turn and opens the new chat (CHAT-16). It is always
 * in this menu: the Experimental setting 'Fork chat to new tab' gates only the chat tab menu item
 * and Cmd+Alt+Enter, as its text says (ui-map.md 3.3 lists the turn menu's fork without it, 6 names
 * the tab menu and the shortcut). Fork to a new workspace (CHAT-21) makes a workspace at the turn's
 * checkpoint and opens the copied chat there.
 * Must handle: A running turn (no footer, TurnItem shows the spinner instead); no usage reported (the hover card
 * says so); an agent that does not report fast mode or cost (that line is left out); no checkpoint
 * (both fork actions and Reset disabled with a reason); a cancelled or errored turn (footer still
 * copies); a copy or fork that fails (a toast, "Unable to fork chat" when the turn has no checkpoint);
 * Reset opens the confirmation dialog instead of changing anything at once. The row wraps at a narrow
 * width instead of collapsing into the menu.
 * Test first: A finished turn with usage shows token counts in the hover card; without a checkpoint
 * Reset and both fork actions are disabled; Fork to new workspace opens the new workspace.
 */

import type { SessionId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { DiffScope } from "../../core/api.ts";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions, useSetting } from "../../core/hooks.ts";
import type { ChatTurn } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { MoreHorizontalIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { MINUTE_MS, useNow } from "../sidebar/use-now.ts";
import { formatCost } from "./ContextWheel.tsx";
import { ResetChatDialog } from "./ResetChatDialog.tsx";
import { reportFailure } from "./report-failure.ts";
import { TurnChanges, turnDiffScope } from "./TurnChanges.tsx";

export interface TurnFooterProps {
	turn: ChatTurn;
	sessionId: SessionId;
	/** Shows the whole turn in the Changes tab. */
	onOpenDiff?: (scope: DiffScope) => void;
	/** Opens one changed file's diff in the turn's scope. */
	onOpenFile?: (path: string, scope: DiffScope) => void;
	/** The current time, for the end time's wording. Defaults to the clock at this edge. */
	now?: number;
}

function clock(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** How long a turn took, as Conductor writes it: "3s", "2m, 4s". */
export function formatTurnDuration(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / 1000);
	const minutes = Math.floor(seconds / 60);
	const rest = `${seconds % 60}s`;
	return minutes > 0 ? `${minutes}m, ${rest}` : rest;
}

const DAY_MS = 86_400_000;

function startOfDay(at: number): number {
	const date = new Date(at);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** When a turn ended: "5:20 PM" today, "Tue 5:20 PM" within a week, else "Oct 12, 3:20 PM". */
export function formatTurnTime(at: number, now: number): string {
	const date = new Date(at);
	const time = date.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
	const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
	if (days === 0) return time;
	if (days > 0 && days < 7)
		return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	const day = date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(sameYear ? {} : { year: "numeric" }),
	});
	return `${day}, ${time}`;
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

export function TurnFooter({ turn, sessionId, onOpenDiff, onOpenFile, now }: TurnFooterProps) {
	const clockNow = useNow(Date.now, MINUTE_MS);
	const today = now ?? clockNow;
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
	const forkToWorkspace = () => {
		void forkFlight.run(`chat:${sessionId}:fork-workspace:${turn.turnId}`, async () => {
			const result = await actions.sessions.forkToWorkspace(sessionId, turn.turnId);
			if (!result.ok) {
				toastError("Unable to fork chat", result.error);
				return;
			}
			const forkedSessionId = result.value.activeSessionId;
			void navigate({
				to: "/repository/$repositoryId/workspace/$workspaceId",
				params: { repositoryId: result.value.repoId, workspaceId: result.value.id },
				...(forkedSessionId === null
					? {}
					: { search: { tab: "session", sessionId: forkedSessionId } as never }),
			});
		});
	};

	const endedAt = turn.endedAt ?? turn.startedAt;
	return (
		<div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-xs text-fg-muted">
			<Tooltip content={detailsOf(turn, showCost)}>
				<button
					type="button"
					aria-label="Turn details"
					className="shrink-0 rounded-sm hover:text-fg"
				>
					{formatTurnDuration(endedAt - turn.startedAt)} · {formatTurnTime(endedAt, today)}
				</button>
			</Tooltip>
			<span className="flex shrink-0 items-center gap-1">
				{finalMessage.length === 0 ? null : (
					<CopyButton
						text={finalMessage}
						onCopy={copy}
						label="Copy final message"
						iconOnly
						size="xs"
						className="size-5 px-0 text-fg-muted"
					/>
				)}
				<Menu>
					<MenuTrigger asChild>
						<Button
							variant="ghost"
							size="xs"
							aria-label="More turn actions"
							title="More actions"
							className="size-5 px-0 text-fg-muted"
						>
							<MoreHorizontalIcon className="size-3.5" />
						</Button>
					</MenuTrigger>
					<MenuContent align="start">
						<MenuItem
							disabled={!canFork}
							title={canFork ? undefined : "This turn has no checkpoint to fork from."}
							onSelect={fork}
						>
							Fork to new tab
						</MenuItem>
						<MenuItem
							disabled={!canFork}
							title={canFork ? undefined : "This turn has no checkpoint to fork from."}
							onSelect={forkToWorkspace}
						>
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
						{turn.changes.length === 0 ? null : (
							<>
								<MenuSeparator />
								<MenuItem
									disabled={onOpenDiff === undefined}
									title={
										onOpenDiff === undefined
											? "The Changes view cannot be opened from this chat."
											: undefined
									}
									onSelect={() => onOpenDiff?.(turnDiffScope(turn, sessionId))}
								>
									Open diff
								</MenuItem>
							</>
						)}
					</MenuContent>
				</Menu>
			</span>
			<TurnChanges turn={turn} sessionId={sessionId} onOpenFile={onOpenFile} />
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
