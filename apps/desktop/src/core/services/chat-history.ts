/**
 * @feature CHAT-06 Message list: a chat's history loads a few turns at a time
 * Owns: what the chat service keeps of a chat's stored history: the turns it shows, how many of
 * the oldest are not loaded yet, and the calls in those turns that loaded events name; the
 * outline of every turn; and merging loaded events in log order.
 * Behaviour: Conductor's chat reads a window of turns (main bundle `egt` @1531473): the last five
 * turns when it opens (`Xmt` @1531402), one more each time the list's top comes within 800 pixels
 * (`expand` @1531832, renderApp `_ma` @9596613, `jQi` @9596045), and its rows in pages of 500
 * (`AA` @1538061). Its turn outline lists every turn from a light query of each turn's first 100
 * characters (`ugt` @1541753) and marks plans in loaded turns only (renderApp @9415668).
 * Must handle: a chat with fewer turns than a page (all of it loads, nothing is older); a turn
 * whose every event is reverted (not shown, so not counted); events that arrive for a turn that is
 * not loaded (left in the database, read when the turn loads); a turn that started after the chat
 * was opened (loaded, never stored here).
 * Our design choice: what is loaded is always every turn from one point to the end, so the list
 * grows at its top only. Conductor can also load one turn alone from its outline and leave a gap;
 * ours loads every turn back to it (see `revealTurn` in sessions.ts, D144).
 * Test first: opening a chat of 223,000 events keeps less than the bound.
 */
import type { TurnId } from "@conducted/shared";
import type { StoredTurn } from "../db/session-events.ts";
import type { ChatHistoryView, ChatTurn, OutlineTurn } from "../model.ts";
import type { StoredEvent } from "./turn-builder.ts";

/** Turns a chat loads when it opens, as Conductor's window starts (`Xmt`). */
export const OPEN_TURNS = 5;

/** What the chat service keeps of one open chat's stored history. */
export interface ChatHistoryState {
	/** The turns the chat showed when it was opened, oldest first. */
	stored: readonly StoredTurn[];
	/** Each stored turn's place in `stored`. */
	positions: ReadonlyMap<TurnId, number>;
	/** How many of `stored`, from the first, are not loaded. Every turn after them is. */
	unloaded: number;
	/** A load of older turns that runs, or that failed and waits for Retry. */
	older: ChatHistoryView["older"];
	/** Calls in the turns that are not loaded which loaded events name (D129). */
	callsNotLoaded: ReadonlySet<string>;
	/** The ids already looked for among the turns that are not loaded, found or not. */
	asked: ReadonlySet<string>;
}

export function newChatHistory(stored: readonly StoredTurn[]): ChatHistoryState {
	return {
		stored,
		positions: new Map(stored.map((turn, index) => [turn.turnId, index])),
		unloaded: Math.max(0, stored.length - OPEN_TURNS),
		older: "idle",
		callsNotLoaded: new Set(),
		asked: new Set(),
	};
}

/** True when the turn is stored and not loaded, so an event of it waits in the database. */
export function isNotLoaded(history: ChatHistoryState | undefined, turnId: TurnId): boolean {
	if (history === undefined) return false;
	const position = history.positions.get(turnId);
	return position !== undefined && position < history.unloaded;
}

/** The turn ids of `stored[from, to)`, the ones a load reads. */
export function turnIdsBetween(history: ChatHistoryState, from: number, to: number): TurnId[] {
	return history.stored.slice(from, to).map((turn) => turn.turnId);
}

/** Every loaded turn id: the stored ones from `unloaded` on, and the ones the events start since. */
export function loadedTurnIds(history: ChatHistoryState, events: readonly StoredEvent[]): TurnId[] {
	const ids = new Set<TurnId>(turnIdsBetween(history, history.unloaded, history.stored.length));
	for (const row of events) ids.add(row.event.turnId);
	return [...ids];
}

/**
 * Two lists of events as one, in `idx` order, each `idx` once (the kept list wins). `kept` is in
 * `idx` order already, so only the added events are sorted and the two are merged in one pass:
 * a load of one older turn costs time in proportion to what is loaded, not more.
 */
export function mergeEvents(
	kept: readonly StoredEvent[],
	added: readonly StoredEvent[],
): StoredEvent[] {
	const incoming = [...added].sort((a, b) => a.idx - b.idx);
	const merged: StoredEvent[] = [];
	const push = (row: StoredEvent): void => {
		if (merged.at(-1)?.idx !== row.idx) merged.push(row);
	};
	let next = 0;
	for (const row of kept) {
		while (next < incoming.length && (incoming[next]?.idx ?? row.idx) < row.idx) {
			push(incoming[next] as StoredEvent);
			next++;
		}
		while (next < incoming.length && incoming[next]?.idx === row.idx) next++;
		push(row);
	}
	for (; next < incoming.length; next++) push(incoming[next] as StoredEvent);
	return merged;
}

export function historyView(history: ChatHistoryState | undefined): ChatHistoryView {
	if (history === undefined || history.unloaded === 0) return { olderTurnId: null, older: "idle" };
	return {
		olderTurnId: history.stored[history.unloaded - 1]?.turnId ?? null,
		older: history.older,
	};
}

function proposesPlan(turn: ChatTurn): boolean {
	return turn.blocks.some(
		(block) => block.kind === "tool" && block.call.item.tool === "exit_plan_mode",
	);
}

/** The outline entries of turns that are not loaded: only what the stored list knows. */
export function storedOutline(history: ChatHistoryState | undefined): OutlineTurn[] {
	if (history === undefined) return [];
	return history.stored.slice(0, history.unloaded).map((turn) => ({
		turnId: turn.turnId,
		text: turn.preview,
		plan: false,
		running: false,
	}));
}

/** Every turn of the chat for its outline: the stored ones not loaded, then the loaded ones. */
export function outlineOf(head: readonly OutlineTurn[], turns: readonly ChatTurn[]): OutlineTurn[] {
	return [
		...head,
		...turns.map((turn) => ({
			turnId: turn.turnId,
			text: turn.userMessage?.text ?? null,
			plan: proposesPlan(turn),
			running: turn.outcome === "running",
		})),
	];
}
