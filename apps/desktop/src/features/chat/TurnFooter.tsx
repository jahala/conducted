/**
 * @feature CHAT-06 Turn footer
 * Owns: The footer under a finished turn: copy actions, token and time details, the file-change
 * summary and the fork and reset menu.
 * Behaviour: ui-map.md 3.3 (Turn footer: 'Copy final message', 'Copy summary', hover card with
 * start and end time and Input, Output, Cache read, Cache write tokens; More menu: 'Fork to new
 * tab', 'Fork to new workspace', 'Reset chat', copy options).
 * Our design choice: Fork to a new workspace is not in the scaffold backlog beyond CHAT-16; its
 * item is shown disabled with the reason until built.
 * Must handle: A running turn (no footer); no usage reported (the hover card says so); no
 * checkpoint (Fork and Reset disabled with a reason); a cancelled or errored turn (footer still
 * copies); reduced width (actions collapse into the More menu).
 * Test first: A finished turn with usage shows token counts in the hover card; without a checkpoint
 * Reset is disabled.
 */
import type { Result, SessionId } from "@conducted/shared";
import { useActions } from "../../core/hooks.ts";
import type { ChatTurn } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { ChevronDownIcon, ClockIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

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

function detailsOf(turn: ChatTurn): string {
	const end = turn.endedAt === null ? "running" : clock(turn.endedAt);
	const usage =
		turn.usage === null
			? "No usage reported."
			: `Input ${turn.usage.inputTokens} · Output ${turn.usage.outputTokens} · Cache read ${turn.usage.cacheReadTokens} · Cache write ${turn.usage.cacheWriteTokens}`;
	return `${clock(turn.startedAt)} to ${end}\n${usage}`;
}

export function TurnFooter({ turn, sessionId }: TurnFooterProps) {
	const actions = useActions();
	const finalMessage = finalMessageOf(turn);
	const summary = summaryOf(turn, finalMessage);
	const canReset = turn.startCheckpointId !== null;
	const canFork = turn.endCheckpointId !== null || canReset;
	const copy = (text: string) => actions.app.copyText(text);

	const share = async (run: () => Promise<Result<unknown>>, message: string) => {
		const result = await run();
		if (!result.ok) toastError(message, result.error);
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
			<Tooltip content={detailsOf(turn)}>
				<Button variant="ghost" size="xs" aria-label="Turn details" className="gap-1">
					<ClockIcon />
					<span>{clock(turn.startedAt)}</span>
				</Button>
			</Tooltip>
			{turn.changes.length > 0 ? (
				<span className="px-1">
					{turn.changes.length} file{turn.changes.length === 1 ? "" : "s"} changed
				</span>
			) : null}
			<Menu>
				<MenuTrigger asChild>
					<Button variant="ghost" size="xs" aria-label="More turn actions">
						<ChevronDownIcon />
					</Button>
				</MenuTrigger>
				<MenuContent>
					<MenuItem
						disabled={!canFork}
						onSelect={() => {
							void share(
								() => actions.sessions.forkFrom(sessionId, turn.turnId),
								"Couldn't fork the chat",
							);
						}}
					>
						Fork to new tab
					</MenuItem>
					<MenuItem disabled title="Fork to a new workspace is built by CHAT-16.">
						Fork to new workspace
					</MenuItem>
					<MenuItem
						disabled={!canReset}
						title={canReset ? undefined : "This turn has no checkpoint to reset to."}
						onSelect={() => {
							void share(
								() => actions.sessions.revertTo(sessionId, turn.turnId),
								"Couldn't reset the chat",
							);
						}}
					>
						Reset chat
					</MenuItem>
					<MenuSeparator />
					<MenuItem onSelect={() => void copy(finalMessage)}>Copy final message</MenuItem>
					<MenuItem onSelect={() => void copy(summary)}>Copy summary</MenuItem>
				</MenuContent>
			</Menu>
		</div>
	);
}
