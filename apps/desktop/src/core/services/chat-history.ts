/**
 * @feature CHAT-06 Message list: a chat's history loads a few turns at a time
 * Owns: what the chat service keeps of a chat's stored history: the turns it shows, which runs of
 * them are loaded, the gaps between those runs, and the calls in turns not loaded that loaded
 * events name; the outline of every turn; and merging loaded events in log order.
 * Behaviour: Conductor's chat reads a window of turns (main bundle `egt` @1531473): the last five
 * turns when it opens (`Xmt` @1531402), one more each time the list's top comes within 800 pixels
 * (`expand` @1531832, renderApp `_ma` @9596613, `jQi` @9596045), and its rows in pages of 500
 * (`AA` @1538061). A turn picked in the outline that is not loaded loads alone, as a range of its
 * own (`revealTurn` @1532172), and the window keeps its ranges apart; between two ranges the list
 * shows a gap that fills one turn at a time, next to the earlier range or the later one
 * (`expandGap` @1532577, `sgt`, renderApp `FQi` @9597304). Its turn outline lists every turn from a
 * light query of each turn's first 100 characters (`ugt` @1541753) and marks plans in loaded turns
 * only (renderApp @9415668).
 * Must handle: a chat with fewer turns than a page (all of it loads, nothing is older); a turn
 * whose every event is reverted (not shown, so not counted); events that arrive for a turn that is
 * not loaded (left in the database, read when the turn loads); a turn that started after the chat
 * was opened (loaded, never stored here); a turn loaded next to a range, which joins it, and a gap
 * that closes when its last turn loads.
 * Test first: opening a chat of 223,000 events keeps less than the bound.
 */
import type { TurnId } from "@conducted/shared";
import type { StoredTurn } from "../db/session-events.ts";
import type { ChatHistoryView, ChatTurn, GapSide, OutlineTurn } from "../model.ts";
import type { StoredEvent } from "./turn-builder.ts";

/** Turns a chat loads when it opens, as Conductor's window starts (`Xmt`). */
export const OPEN_TURNS = 5;

/** A run of loaded turns: the stored turns from `from` up to, not including, `to`. */
export interface LoadedRun {
	from: number;
	to: number;
}

/** What the chat service keeps of one open chat's stored history. */
export interface ChatHistoryState {
	/** The turns the chat showed when it was opened, oldest first. */
	stored: readonly StoredTurn[];
	/** Each stored turn's place in `stored`. */
	positions: ReadonlyMap<TurnId, number>;
	/**
	 * The loaded runs of `stored`, oldest first, none touching another; the last one ends at the
	 * end. Turns before the first are older; turns between two runs are a gap.
	 */
	loaded: readonly LoadedRun[];
	/** A load of older turns that runs, or that failed and waits for Retry. */
	older: ChatHistoryView["older"];
	/** Gaps a fill runs in, or whose fill failed and waits for Retry, by the turn after the gap. */
	gaps: ReadonlyMap<TurnId, "loading" | "failed">;
	/** Calls in the turns that are not loaded which loaded events name (D129). */
	callsNotLoaded: ReadonlySet<string>;
	/** The ids already looked for among the turns that are not loaded, found or not. */
	asked: ReadonlySet<string>;
}

const NO_GAPS: ReadonlyMap<TurnId, "loading" | "failed"> = new Map();

export function newChatHistory(stored: readonly StoredTurn[]): ChatHistoryState {
	return {
		stored,
		positions: new Map(stored.map((turn, index) => [turn.turnId, index])),
		loaded: [{ from: Math.max(0, stored.length - OPEN_TURNS), to: stored.length }],
		older: "idle",
		gaps: NO_GAPS,
		callsNotLoaded: new Set(),
		asked: new Set(),
	};
}

/** How many stored turns, from the first, are older than every loaded one. */
export function olderCount(history: ChatHistoryState): number {
	return history.loaded[0]?.from ?? history.stored.length;
}

/** True when every stored turn is loaded. */
export function allLoaded(history: ChatHistoryState): boolean {
	return history.loaded.length === 1 && olderCount(history) === 0;
}

/** True for a stored position inside one of the loaded runs. */
export function isLoadedPosition(history: ChatHistoryState, position: number): boolean {
	return history.loaded.some((run) => position >= run.from && position < run.to);
}

/** True when the turn is stored and not loaded, so an event of it waits in the database. */
export function isNotLoaded(history: ChatHistoryState | undefined, turnId: TurnId): boolean {
	if (history === undefined) return false;
	const position = history.positions.get(turnId);
	return position !== undefined && !isLoadedPosition(history, position);
}

/** The history with the stored turn at `position` loaded, joined to any run it touches. */
export function withLoadedTurn(history: ChatHistoryState, position: number): ChatHistoryState {
	if (isLoadedPosition(history, position)) return history;
	const runs = [...history.loaded, { from: position, to: position + 1 }].sort(
		(a, b) => a.from - b.from,
	);
	const joined: LoadedRun[] = [];
	for (const run of runs) {
		const last = joined.at(-1);
		if (last !== undefined && run.from <= last.to) last.to = Math.max(last.to, run.to);
		else joined.push({ ...run });
	}
	return { ...history, loaded: joined };
}

/** The stored position a gap's fill loads, or null when no gap starts before that turn. */
export function gapTurn(
	history: ChatHistoryState,
	beforeTurnId: TurnId,
	side: GapSide,
): number | null {
	const index = history.loaded.findIndex(
		(run) => history.stored[run.from]?.turnId === beforeTurnId,
	);
	const earlier = history.loaded[index - 1];
	const later = history.loaded[index];
	if (index < 1 || earlier === undefined || later === undefined) return null;
	return side === "after-earlier" ? earlier.to : later.from - 1;
}

/** The turn ids of `stored[from, to)`, the ones a load reads. */
export function turnIdsBetween(history: ChatHistoryState, from: number, to: number): TurnId[] {
	return history.stored.slice(from, to).map((turn) => turn.turnId);
}

/** Every loaded turn id: the stored ones in the loaded runs, and the ones the events start since. */
export function loadedTurnIds(history: ChatHistoryState, events: readonly StoredEvent[]): TurnId[] {
	const ids = new Set<TurnId>();
	for (const run of history.loaded) {
		for (const turnId of turnIdsBetween(history, run.from, run.to)) ids.add(turnId);
	}
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
	if (history === undefined) return { olderTurnId: null, older: "idle", gaps: [] };
	const older = olderCount(history);
	return {
		olderTurnId: older === 0 ? null : (history.stored[older - 1]?.turnId ?? null),
		older: older === 0 ? "idle" : history.older,
		gaps: history.loaded.slice(1).flatMap((run) => {
			const beforeTurnId = history.stored[run.from]?.turnId;
			if (beforeTurnId === undefined) return [];
			return [{ beforeTurnId, state: history.gaps.get(beforeTurnId) ?? ("idle" as const) }];
		}),
	};
}

function proposesPlan(turn: ChatTurn): boolean {
	return turn.blocks.some(
		(block) => block.kind === "tool" && block.call.item.tool === "exit_plan_mode",
	);
}

/** Each stored turn's outline entry while it is not loaded: only what the stored list knows. */
const storedEntries = new WeakMap<StoredTurn, OutlineTurn>();

function storedEntry(turn: StoredTurn): OutlineTurn {
	const kept = storedEntries.get(turn);
	if (kept !== undefined) return kept;
	const entry = { turnId: turn.turnId, text: turn.preview, plan: false, running: false };
	storedEntries.set(turn, entry);
	return entry;
}

/**
 * Every turn of the chat for its outline, in order: a stored turn that is not loaded by what the
 * stored list knows, a loaded one by its built turn, then the turns started since the chat opened.
 * The built turns are in stored order, so one pass over both lists pairs them; a loaded turn with
 * no built turn (its events were reverted since) is left out.
 */
export function outlineOf(
	history: ChatHistoryState | undefined,
	turns: readonly ChatTurn[],
): OutlineTurn[] {
	if (history === undefined) return turns.map(outlineEntry);
	const outline: OutlineTurn[] = [];
	let next = 0;
	let position = 0;
	for (const run of history.loaded) {
		for (; position < run.from; position += 1) {
			outline.push(storedEntry(history.stored[position] as StoredTurn));
		}
		for (; position < run.to; position += 1) {
			const turn = turns[next];
			if (turn?.turnId !== history.stored[position]?.turnId) continue;
			outline.push(outlineEntry(turn as ChatTurn));
			next += 1;
		}
	}
	for (; next < turns.length; next += 1) outline.push(outlineEntry(turns[next] as ChatTurn));
	return outline;
}

/** Each built turn's outline entry, kept while the turn object lives, so a turn is read once. */
const outlineEntries = new WeakMap<ChatTurn, OutlineTurn>();

function outlineEntry(turn: ChatTurn): OutlineTurn {
	const kept = outlineEntries.get(turn);
	if (kept !== undefined) return kept;
	const entry = {
		turnId: turn.turnId,
		text: turn.userMessage?.text ?? null,
		plan: proposesPlan(turn),
		running: turn.outcome === "running",
	};
	outlineEntries.set(turn, entry);
	return entry;
}
