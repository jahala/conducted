/**
 * @feature CHAT-25 Turn outline and jump list
 * Owns: the "Table of contents" control beside the message list: a thin strip of ticks, one per turn,
 * and a jump list of one-line turn summaries that scrolls the chat to a picked turn.
 * Behaviour: coverage/inventory-controls.md (a button labelled "Table of contents" next to the message
 * list; a thin strip of ticks where plans are marked and the current turn is highlighted; it opens a
 * list of turns with a one-line summary each; picking one scrolls the chat to that turn); ui-map.md
 * 3.3 (the chat list is virtualised, one item per turn); services-map.md 2.5.2 (Conductor's cloud
 * chats read a turn outline from the server; a local chat builds it from the turns it already has).
 * The outline lists every turn of the chat, loaded or not (CHAT-06): a turn the list has not loaded
 * shows the start of its message from the stored list, and its plan is not marked until it loads,
 * as in Conductor (renderApp @9415668).
 * Our design choice: the one-line summary is the first non-empty line of the user's message, cut to
 * one line, or "Started by the agent" for a turn the agent started. A turn that proposed a plan gets
 * a taller, accent-coloured tick. At most 24 ticks are drawn; a longer chat groups its turns into
 * those ticks. The jump list is virtualised with react-virtuoso and closes after a pick, returning
 * focus to the trigger.
 * Must handle: a chat with no turns (nothing shown); one turn (nothing to jump between); 2,000 turns
 * (grouped ticks and a virtualised list); the current turn changing while the user scrolls (only the
 * newest scroll position updates the highlight); a jump to a turn the virtual list has not drawn (the
 * caller scrolls by index); a running turn (its tick pulses, and the shared stylesheet turns the pulse
 * off under reduced motion); the list opening and closing from the keyboard with focus returned to the
 * button.
 * Test first: three turns give three ticks; picking the second calls onJumpToTurn with its id.
 */
import type { TurnId } from "@conducted/shared";
import { Popover as Radix } from "radix-ui";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import type { OutlineTurn } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { Popover } from "../../ui/Popover.tsx";

export interface TurnOutlineProps {
	/** Every turn of the chat, loaded or not. */
	turns: readonly OutlineTurn[];
	/** The turn at the top of the visible part of the list. Null when none is visible yet. */
	currentTurnId: TurnId | null;
	onJumpToTurn: (turnId: TurnId) => void;
}

/** The strip's tallest form: a longer chat groups its turns into this many ticks. */
const MAX_TICKS = 24;
/** The jump list's tallest form, in rows of 32 pixels. */
const MAX_LIST_ROWS = 8;

interface OutlineTick {
	turnId: TurnId;
	plan: boolean;
	running: boolean;
	current: boolean;
}

function summaryOf(turn: OutlineTurn): string {
	if (turn.text === null) return "Started by the agent";
	const line = turn.text
		.split("\n")
		.map((part) => part.trim())
		.find((part) => part.length > 0);
	return line ?? "Message with no text";
}

/** One tick per turn, or one per group once the chat has more turns than the strip can draw. */
function ticksFor(turns: readonly OutlineTurn[], currentTurnId: TurnId | null): OutlineTick[] {
	const perTick = Math.ceil(turns.length / MAX_TICKS);
	const tickCount = Math.min(turns.length, MAX_TICKS);
	const ticks: OutlineTick[] = [];
	for (let index = 0; index < tickCount; index++) {
		const group = turns.slice(index * perTick, (index + 1) * perTick);
		const first = group[0];
		if (first === undefined) continue;
		ticks.push({
			turnId: first.turnId,
			plan: group.some((turn) => turn.plan),
			running: group.some((turn) => turn.running),
			current: currentTurnId !== null && group.some((turn) => turn.turnId === currentTurnId),
		});
	}
	return ticks;
}

export function TurnOutline({ turns, currentTurnId, onJumpToTurn }: TurnOutlineProps) {
	const ticks = useMemo(() => ticksFor(turns, currentTurnId), [turns, currentTurnId]);
	const listHeight = Math.min(Math.max(turns.length, 1), MAX_LIST_ROWS) * 32 + 8;

	// A chat with nothing to jump between has no outline.
	if (turns.length < 2) return null;

	return (
		<Popover
			side="left"
			align="center"
			className="w-72"
			trigger={
				<Button
					variant="ghost"
					size="xs"
					aria-label="Table of contents"
					title="Table of contents"
					style={{ height: "auto", width: 20, paddingInline: 4 }}
				>
					<span aria-hidden="true" className="flex flex-col items-center gap-0.5 py-1">
						{ticks.map((tick) => (
							<span
								key={tick.turnId}
								data-testid="turn-outline-tick"
								data-turn-id={tick.turnId}
								className={cn(
									"w-3 rounded-full",
									tick.plan ? "h-1.5" : "h-1",
									tick.current || tick.plan ? "bg-accent" : "bg-border-strong",
									tick.running && "animate-pulse",
								)}
							/>
						))}
					</span>
				</Button>
			}
		>
			<section aria-label="Turns">
				<div style={{ height: listHeight }}>
					<Virtuoso
						data={turns}
						computeItemKey={(_, turn) => turn.turnId}
						itemContent={(_, turn) => {
							const current = turn.turnId === currentTurnId;
							return (
								<Radix.Close asChild>
									<button
										type="button"
										aria-current={current ? "location" : undefined}
										onClick={() => onJumpToTurn(turn.turnId)}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg outline-none hover:bg-hover",
											current && "bg-hover",
										)}
									>
										<span
											aria-hidden="true"
											className={cn(
												"h-3 w-0.5 shrink-0 rounded-full",
												turn.plan ? "bg-accent" : "bg-border-strong",
											)}
										/>
										<span className="truncate">{summaryOf(turn)}</span>
									</button>
								</Radix.Close>
							);
						}}
					/>
				</div>
			</section>
		</Popover>
	);
}
