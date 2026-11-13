/**
 * @feature CHAT-07 Turn builder: stored events to chat turns
 * Owns: grouping a chat's events into turns for the chat list, pairing tool calls with their
 * results, nesting sub-agent work under the call that started it, and rebuilding only the turns an
 * update changes, so every other turn stays the same object between builds (#653).
 * Behaviour: frontend.md 5 (turn building, sub-agent buckets), sessions.md 5 (event types),
 * sessions-and-chats.md "How chats are stored".
 * Must handle: events arrive in `idx` order but a tool result may arrive in a later event than
 * its call; a call without a result yet is shown as running; a sub-agent's messages and calls
 * carry `parentToolUseId` and nest under that call at any depth, while a call whose parent chain
 * loops stays at the top level; a background helper's work that arrives in a later turn than the
 * call that started it goes inside that call's card, after what the card already holds, and a
 * late result goes to its call (D129); work whose parent call never arrived stays at the top level
 * of the turn it arrives in; events with `reverted_at` set are left out of the turns (the revert
 * hides them) and mark the turn reverted; a tool result whose call never arrived shows a notice;
 * a steer message belongs to the turn it steered and shows `consumed` once the live state no
 * longer lists it as pending; a turn without a `turn_ended` event while the chat is idle is shown
 * as interrupted; usage items add up per turn; text and thinking items of one message stay in
 * order; unknown item kinds are skipped with a notice block, never a crash; a Claude message of
 * text only that repeats a sign-in error is hidden when the turn's result shows the sign-in view
 * (renderApp kpa @9558460); rows appended, rows of older turns merged in, rows replaced by a
 * revert, and a changed live state or set of calls not loaded, each rebuilding only what it changes.
 * Our design choice: a `TurnBuilder` keeps, per turn, what the turn's own rows say (its draft),
 * where each of its entries shows (its placement: in its own turn, or in the card of a call of an
 * earlier turn, D129), and the turn it last built. An update finds the rows that changed by
 * comparing the new array with the last one by identity, applies appended rows to their drafts in
 * place, works out which placements those changes can move (through an index of who names which
 * call), and builds again only the turns whose drafts or placed work changed. `buildTurns` is a new
 * builder's first update, so a one-off build and an update share every rule. Conductor builds each
 * turn from its own rows only and shows a sub-agent's work from a later turn nowhere (main `wp`
 * @1423850, `_mt` @1427823); we show it in the card that started it, by the owner's ruling (D129).
 * Test first: a tool_call event followed later by its tool_result yields one tool block with both.
 */
import {
	AGENT_ERROR_CODES,
	type AgentItem,
	isClaudeSignInErrorText,
	type LiveState,
	type SessionEvent,
} from "@conducted/protocol";
import type { MessageId } from "@conducted/shared";
import type { ChatBlock, ChatTurn, ToolCallView } from "../model.ts";

/** One row of `session_events` as the chat sees it. */
export interface StoredEvent {
	idx: number;
	event: SessionEvent;
	receivedAt: number;
	revertedAt: number | null;
}

type TurnEnded = Extract<SessionEvent, { type: "turn_ended" }>;
type ToolCallItem = Extract<AgentItem, { kind: "tool_call" }>;
type ToolResultItem = Extract<AgentItem, { kind: "tool_result" }>;
type UsageItem = Extract<AgentItem, { kind: "usage" }>;
type Usage = NonNullable<ChatTurn["usage"]>;

/**
 * A message handed to the sidecar whose `user_message` event has not arrived yet. The chat shows
 * it at the end of the transcript as an optimistic turn, until the stored event replaces it.
 */
export interface PendingSend {
	messageId: MessageId;
	text: string;
	at: number;
	/** A steer joins the running turn instead of showing as a turn of its own. */
	delivery?: "new_turn" | "steer";
}

type Entry =
	| {
			kind: "block";
			block: ChatBlock;
			parent: string | undefined;
			/** Text of a Claude message that only repeats a sign-in error (see `isSignInEcho`). */
			signInEcho?: true;
	  }
	| { kind: "tool"; item: ToolCallItem; parent: string | undefined };

/** What one turn's own rows say, before its entries are placed. */
interface TurnDraft {
	turnId: ChatTurn["turnId"];
	/** The turn's rows, in the order the chat's events hold them. */
	rows: StoredEvent[];
	userMessage: ChatTurn["userMessage"];
	steers: { messageId: MessageId; text: string; at: number }[];
	entries: Entry[];
	/** For each tool-use id, the index of the last entry that is a call with that id. */
	calls: Map<string, number>;
	/** The call each nested call belongs to, by tool-use id. */
	parents: Map<string, string>;
	/** Results seen in this turn, by tool-use id; the last one counts. */
	results: Map<string, ToolResultItem>;
	usage: Usage | null;
	startCheckpointId: string | null;
	endCheckpointId: string | null;
	changes: ChatTurn["changes"];
	end: TurnEnded | null;
	startedAt: number;
	/** Events that still count, after the reverted ones were skipped. */
	liveEvents: number;
	reverted: boolean;
	/** A Claude result in this turn shows the sign-in view. */
	claudeSignInResult: boolean;
	/** The `user_message` ids the turn's rows hold that were not reverted. */
	messageIds: string[];
}

/** A call's card: the entry of a turn that holds the call. */
interface CallRef {
	turn: string;
	entry: number;
}

/** Where one entry shows: in the turn `root`, at its top level or inside a call's card. */
interface Target {
	root: string;
	holder: CallRef | null;
}

/** Where every entry of a turn shows, and where its results for other turns' calls go. */
interface Placement {
	/** Per entry; null for an entry that shows nowhere. */
	entries: (Target | null)[];
	/** Results for calls this turn does not hold: to a card, or a notice in this turn when unknown. */
	results: { item: ToolResultItem; target: CallRef | null; root: string }[];
	/** Every turn this turn's work shows in, its own first. */
	roots: readonly string[];
	/** The tool-use ids whose calls the placement read, so a change to one moves it again. */
	consulted: readonly string[];
	/** The turn each of this turn's calls shows in, by tool-use id; null where it shows nowhere. */
	callRoots: Map<string, string | null>;
	/** The draft it was worked out from. */
	draft: TurnDraft;
	/** The results of this turn's own calls when it was worked out, by the call's entry. */
	ownResults: [number, ToolResultItem][];
}

function emptyDraft(turnId: ChatTurn["turnId"], at: number): TurnDraft {
	return {
		turnId,
		rows: [],
		userMessage: null,
		steers: [],
		entries: [],
		calls: new Map(),
		parents: new Map(),
		results: new Map(),
		usage: null,
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		end: null,
		startedAt: at,
		liveEvents: 0,
		reverted: false,
		claudeSignInResult: false,
		messageIds: [],
	};
}

function addUsage(current: Usage | null, item: UsageItem): Usage {
	return {
		costUsd:
			item.costUsd === undefined
				? (current?.costUsd ?? null)
				: (current?.costUsd ?? 0) + item.costUsd,
		inputTokens: (current?.inputTokens ?? 0) + item.inputTokens,
		outputTokens: (current?.outputTokens ?? 0) + item.outputTokens,
		cacheReadTokens: (current?.cacheReadTokens ?? 0) + item.cacheReadTokens,
		cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + item.cacheWriteTokens,
		fastMode: item.fastMode === undefined ? (current?.fastMode ?? null) : item.fastMode,
		model: item.model === undefined ? (current?.model ?? null) : item.model,
	};
}

function applyItem(draft: TurnDraft, item: AgentItem, parent: string | undefined): void {
	switch (item.kind) {
		case "text":
			draft.entries.push({
				kind: "block",
				block: { kind: "text", text: item.text },
				parent,
			});
			return;
		case "thinking":
			draft.entries.push({
				kind: "block",
				block: { kind: "thinking", text: item.text, summarized: item.summarized },
				parent,
			});
			return;
		case "tool_call": {
			const owner = item.parentToolUseId ?? parent;
			if (owner !== undefined) draft.parents.set(item.toolUseId, owner);
			draft.calls.set(item.toolUseId, draft.entries.length);
			draft.entries.push({ kind: "tool", item, parent: owner });
			return;
		}
		case "tool_result":
			draft.results.set(item.toolUseId, item);
			return;
		case "todo":
			draft.entries.push({ kind: "block", block: { kind: "todo", item }, parent });
			return;
		case "notice":
			draft.entries.push({ kind: "block", block: { kind: "notice", item }, parent });
			return;
		case "error":
			draft.entries.push({ kind: "block", block: { kind: "error", item }, parent });
			return;
		case "usage":
			draft.usage = addUsage(draft.usage, item);
			return;
		case "background_task": {
			// The call that started it, when it came first in this turn, as Conductor looks it up.
			const at = item.toolUseId === undefined ? undefined : draft.calls.get(item.toolUseId);
			const started = at === undefined ? undefined : draft.entries[at];
			draft.entries.push({
				kind: "block",
				block: {
					kind: "background_task",
					item,
					source: started?.kind === "tool" ? started.item : null,
				},
				parent,
			});
			return;
		}
		default: {
			const unknown = item as unknown as { kind?: unknown };
			const kind = typeof unknown.kind === "string" ? `: ${unknown.kind}` : ".";
			draft.entries.push({
				kind: "block",
				block: {
					kind: "notice",
					item: { kind: "notice", notice: "info", text: `Unsupported message item${kind}` },
				},
				parent,
			});
		}
	}
}

/**
 * True for a Claude message of text only whose text is a sign-in error. Conductor hides such a
 * message when the turn's result shows the sign-in view (renderApp kpa @9558460, CQi @9517683),
 * so the error is not said twice. The Claude translator gives the sign-in code only to a result.
 */
function isSignInEcho(message: Extract<SessionEvent, { type: "agent" }>["message"]): boolean {
	if (message.agent !== "claude" || message.items.length === 0) return false;
	const texts: string[] = [];
	for (const item of message.items) {
		if (item.kind !== "text") return false;
		texts.push(item.text);
	}
	return isClaudeSignInErrorText(texts.join("\n"));
}

function applyEvent(draft: TurnDraft, event: SessionEvent): void {
	switch (event.type) {
		case "user_message":
			// The first user message starts the turn; Conductor shows every later one as a steer,
			// whichever kind of event carried it.
			if (event.delivery === "new_turn" && draft.userMessage === null) {
				draft.userMessage = {
					messageId: event.messageId,
					text: event.text,
					attachmentPaths: event.attachmentPaths,
					at: event.at,
					sender: event.sender ?? null,
				};
				return;
			}
			draft.steers.push({ messageId: event.messageId, text: event.text, at: event.at });
			return;
		case "agent": {
			const message = event.message;
			const echo = isSignInEcho(message);
			const first = draft.entries.length;
			for (const item of message.items) {
				applyItem(draft, item, message.parentToolUseId);
			}
			if (echo) {
				for (let index = first; index < draft.entries.length; index += 1) {
					const entry = draft.entries[index];
					if (entry?.kind === "block") entry.signInEcho = true;
				}
			}
			if (
				message.agent === "claude" &&
				message.items.some(
					(item) => item.kind === "error" && item.code === AGENT_ERROR_CODES.authRequired,
				)
			) {
				draft.claudeSignInResult = true;
			}
			return;
		}
		case "checkpoint":
			if (event.phase === "start") {
				draft.startCheckpointId = event.checkpointId ?? null;
			} else {
				draft.endCheckpointId = event.checkpointId ?? null;
				draft.changes = event.changes ?? [];
			}
			return;
		case "turn_ended":
			draft.end = event;
			return;
	}
}

/** Adds one row to its turn's draft. */
function applyRow(draft: TurnDraft, row: StoredEvent): void {
	draft.rows.push(row);
	draft.startedAt = Math.min(draft.startedAt, row.event.at);
	if (row.revertedAt !== null) {
		// The turn keeps the events that were not reverted, and says it was partly undone.
		draft.reverted = true;
		return;
	}
	if (row.event.type === "user_message") draft.messageIds.push(row.event.messageId);
	draft.liveEvents += 1;
	applyEvent(draft, row.event);
}

function draftOf(turnId: string, rows: readonly StoredEvent[]): TurnDraft {
	const first = rows[0];
	const draft = emptyDraft(turnId as ChatTurn["turnId"], first === undefined ? 0 : first.event.at);
	for (const row of rows) applyRow(draft, row);
	return draft;
}

/** The tool-use ids of the calls one agent row holds. */
function rowCalls(row: StoredEvent): string[] {
	if (row.event.type !== "agent") return [];
	const ids: string[] = [];
	for (const item of row.event.message.items)
		if (item.kind === "tool_call") ids.push(item.toolUseId);
	return ids;
}

/** The tool-use ids one agent row names as a parent, an owner or a result. */
function rowNames(row: StoredEvent): string[] {
	if (row.event.type !== "agent") return [];
	const message = row.event.message;
	const ids: string[] = [];
	if (message.parentToolUseId !== undefined) ids.push(message.parentToolUseId);
	for (const item of message.items) {
		if (item.kind === "tool_call" && item.parentToolUseId !== undefined)
			ids.push(item.parentToolUseId);
		if (item.kind === "tool_result") ids.push(item.toolUseId);
	}
	return ids;
}

const refKey = (ref: CallRef): string => `${ref.entry}\u0000${ref.turn}`;

const NO_CALLS: ReadonlySet<string> = new Set();
const NO_IDS: readonly string[] = [];
const NO_SENDS: readonly PendingSend[] = [];

/** Adds `value` to the set kept under `key`. */
function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
	const set = map.get(key);
	if (set === undefined) map.set(key, new Set([value]));
	else set.add(value);
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
	return true;
}

/** Turn ids by position, smallest first: a binary heap. */
class PositionQueue {
	readonly #items: string[] = [];
	readonly #position: (turnId: string) => number;

	constructor(position: (turnId: string) => number) {
		this.#position = position;
	}

	push(turnId: string): void {
		const items = this.#items;
		items.push(turnId);
		let index = items.length - 1;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (this.#position(items[parent] as string) <= this.#position(turnId)) break;
			items[index] = items[parent] as string;
			index = parent;
		}
		items[index] = turnId;
	}

	pop(): string | undefined {
		const items = this.#items;
		const top = items[0];
		const last = items.pop();
		if (items.length === 0 || last === undefined) return top;
		let index = 0;
		const at = this.#position(last);
		for (;;) {
			const left = index * 2 + 1;
			if (left >= items.length) break;
			const right = left + 1;
			const child =
				right < items.length &&
				this.#position(items[right] as string) < this.#position(items[left] as string)
					? right
					: left;
			if (this.#position(items[child] as string) >= at) break;
			items[index] = items[child] as string;
			index = child;
		}
		items[index] = last;
		return top;
	}
}

/**
 * Builds a chat's turns from its stored events and keeps what it needs to build them again after
 * a change without redoing the turns the change does not reach. Each turn that shows the same as
 * in the last update is that update's object, so a memoised list item skips it.
 */
export class TurnBuilder {
	#rows: readonly StoredEvent[] = [];
	#drafts = new Map<string, TurnDraft>();
	/** Every turn the rows name, in the order its first row appears. */
	#order: string[] = [];
	/** The turns with an event that still counts, in order, and each one's position. */
	#live: string[] = [];
	#position = new Map<string, number>();
	/** The live turns that hold a call, by tool-use id, in turn order. */
	#callTurns = new Map<string, string[]>();
	/** The live turns whose entries or results name a tool-use id. */
	#namedBy = new Map<string, Set<string>>();
	/** The turns whose placement read a tool-use id's call while walking a parent chain. */
	#consultedBy = new Map<string, Set<string>>();
	/** The live turn of each steer, by message id. */
	#steerTurn = new Map<string, string>();
	#placements = new Map<string, Placement>();
	/** For each turn, the other turns whose work shows in it. */
	#contributors = new Map<string, Set<string>>();
	#built = new Map<string, ChatTurn>();
	#turns: ChatTurn[] = [];
	#liveState: LiveState | null = null;
	#callsNotLoaded: ReadonlySet<string> = NO_CALLS;
	#sends: readonly PendingSend[] = NO_SENDS;
	#shown: ChatTurn[] = [];

	/**
	 * The turns of `events`. Pending sends are a second overlay: a message whose `user_message`
	 * event has not been stored yet appears as a running turn at the end, and a pending steer is
	 * added to the last turn's steers as not yet read. When the events are the chat's last turns
	 * only (CHAT-06), `callsNotLoaded` names the calls of the earlier turns that the events refer
	 * to, so their late work stays in those turns as in a build of every turn.
	 */
	update(
		events: readonly StoredEvent[],
		liveState: LiveState,
		pendingSends: readonly PendingSend[] = NO_SENDS,
		callsNotLoaded: ReadonlySet<string> = NO_CALLS,
	): ChatTurn[] {
		const previousLive = this.#live;
		const previousLast = previousLive.at(-1);
		const touched = new Set<string>();
		const changedIds = new Set<string>();
		const orderChanged = this.#syncRows(events, touched, changedIds);

		const invalid = new Set<string>();
		const dirty = new Set<string>();
		for (const turnId of touched) {
			invalid.add(turnId);
			dirty.add(turnId);
		}
		for (const id of changedIds) {
			for (const turnId of this.#namedBy.get(id) ?? []) invalid.add(turnId);
			for (const turnId of this.#consultedBy.get(id) ?? []) invalid.add(turnId);
		}
		if (callsNotLoaded !== this.#callsNotLoaded) {
			for (const id of symmetricDifference(callsNotLoaded, this.#callsNotLoaded)) {
				for (const turnId of this.#namedBy.get(id) ?? []) invalid.add(turnId);
			}
			this.#callsNotLoaded = callsNotLoaded;
		}
		// Turns that stopped showing leave their work's cards; their old roots build again.
		for (const turnId of orderChanged ? previousLive : []) {
			if (this.#position.has(turnId)) continue;
			const old = this.#placements.get(turnId);
			for (const root of old?.roots ?? []) dirty.add(root);
			this.#forgetPlacement(turnId);
			this.#built.delete(turnId);
			this.#contributors.delete(turnId);
		}

		this.#settlePlacements(invalid, dirty);

		const last = this.#live.at(-1);
		const previousState = this.#liveState;
		// Only a turn without an end marker reads the live state's status, and only as the last turn.
		if (
			previousState === null ||
			previousState.status !== liveState.status ||
			last !== previousLast
		) {
			for (const turnId of [last, previousLast]) {
				if (turnId === undefined || !this.#position.has(turnId)) continue;
				if (this.#drafts.get(turnId)?.end === null) dirty.add(turnId);
			}
		}
		if (
			previousState !== null &&
			!sameItems(previousState.pendingSteerIds, liveState.pendingSteerIds)
		) {
			const flipped = symmetricDifference(
				new Set(liveState.pendingSteerIds),
				new Set(previousState.pendingSteerIds),
			);
			for (const id of flipped) {
				const turnId = this.#steerTurn.get(id);
				if (turnId !== undefined) dirty.add(turnId);
			}
		}
		this.#liveState = liveState;

		const rebuilt: string[] = [];
		for (const turnId of dirty) {
			if (!this.#position.has(turnId)) continue;
			const built = this.#build(turnId, liveState);
			const before = this.#built.get(turnId);
			if (before !== undefined && sameTurn(before, built)) continue;
			this.#built.set(turnId, built);
			rebuilt.push(turnId);
		}
		const turnsChanged = orderChanged || rebuilt.length > 0;
		if (orderChanged) {
			this.#turns = this.#live.map((turnId) => this.#built.get(turnId) as ChatTurn);
		} else if (rebuilt.length > 0) {
			const turns = [...this.#turns];
			for (const turnId of rebuilt) {
				turns[this.#position.get(turnId) as number] = this.#built.get(turnId) as ChatTurn;
			}
			this.#turns = turns;
		}
		if (turnsChanged || !samePending(pendingSends, this.#sends)) {
			this.#shown = this.#withPending(this.#turns, pendingSends);
			this.#sends = pendingSends;
		}
		return this.#shown;
	}

	/**
	 * Brings the drafts up to `events`. Rows appended after the last update are applied to their
	 * turns in place; any other change rebuilds the drafts of the turns whose rows differ. Adds the
	 * turns whose rows changed to `touched`, and to `changedIds` every call id whose card may have
	 * moved: one that appeared, went, or belongs to a turn whose draft was rebuilt. Returns whether
	 * the live turns' order changed.
	 */
	#syncRows(
		events: readonly StoredEvent[],
		touched: Set<string>,
		changedIds: Set<string>,
	): boolean {
		const old = this.#rows;
		if (events === old) return false;
		this.#rows = events;
		let prefix = 0;
		const shorter = Math.min(old.length, events.length);
		while (prefix < shorter && old[prefix] === events[prefix]) prefix += 1;
		return prefix === old.length
			? this.#appendRows(events, prefix, touched, changedIds)
			: this.#regroupRows(events, touched, changedIds);
	}

	#appendRows(
		events: readonly StoredEvent[],
		from: number,
		touched: Set<string>,
		changedIds: Set<string>,
	): boolean {
		const created = new Set<string>();
		const becameLive: string[] = [];
		for (let index = from; index < events.length; index += 1) {
			const row = events[index] as StoredEvent;
			const turnId = row.event.turnId;
			let draft = this.#drafts.get(turnId);
			if (draft === undefined) {
				draft = emptyDraft(turnId, row.event.at);
				this.#drafts.set(turnId, draft);
				this.#order.push(turnId);
				created.add(turnId);
			}
			const wasLive = draft.liveEvents > 0;
			const steers = draft.steers.length;
			applyRow(draft, row);
			touched.add(turnId);
			if (!wasLive) {
				if (draft.liveEvents > 0) becameLive.push(turnId);
				continue;
			}
			if (row.revertedAt !== null) continue;
			for (const id of rowCalls(row)) {
				changedIds.add(id);
				if (this.#callTurns.get(id)?.includes(turnId) !== true) this.#addCallTurn(id, turnId);
			}
			for (const id of rowNames(row)) if (!draft.calls.has(id)) addTo(this.#namedBy, id, turnId);
			for (const steer of draft.steers.slice(steers)) this.#steerTurn.set(steer.messageId, turnId);
		}
		if (becameLive.length === 0) return false;
		if (becameLive.some((turnId) => !created.has(turnId))) {
			// A turn that counted for nothing began to count: the turns after it see new earlier calls.
			for (const turnId of becameLive) {
				for (const [id] of (this.#drafts.get(turnId) as TurnDraft).calls) changedIds.add(id);
			}
			this.#reindex();
			return true;
		}
		// New turns at the end: the turns before them see nothing new.
		const live = new Set(becameLive);
		for (const turnId of this.#order.slice(this.#order.length - created.size)) {
			if (!live.has(turnId)) continue;
			const draft = this.#drafts.get(turnId) as TurnDraft;
			this.#position.set(turnId, this.#live.length);
			this.#live.push(turnId);
			this.#indexDraft(turnId, draft);
			for (const [id] of draft.calls) changedIds.add(id);
		}
		return true;
	}

	/** Some earlier row changed or rows were merged in: compares each turn's rows. */
	#regroupRows(
		events: readonly StoredEvent[],
		touched: Set<string>,
		changedIds: Set<string>,
	): boolean {
		const grouped = new Map<string, StoredEvent[]>();
		const order: string[] = [];
		for (const row of events) {
			const turnId = row.event.turnId;
			let rows = grouped.get(turnId);
			if (rows === undefined) {
				rows = [];
				grouped.set(turnId, rows);
				order.push(turnId);
			}
			rows.push(row);
		}
		for (const [turnId, draft] of this.#drafts) {
			if (grouped.has(turnId)) continue;
			touched.add(turnId);
			for (const [id] of draft.calls) changedIds.add(id);
			this.#drafts.delete(turnId);
		}
		for (const [turnId, rows] of grouped) {
			const before = this.#drafts.get(turnId);
			if (before !== undefined && sameItems(before.rows, rows)) continue;
			const after = draftOf(turnId, rows);
			touched.add(turnId);
			// The entries are new, so every card a later turn found in this turn is found again.
			for (const [id] of before?.calls ?? []) changedIds.add(id);
			for (const [id] of after.calls) changedIds.add(id);
			this.#drafts.set(turnId, after);
		}
		const previous = this.#live;
		this.#order = order;
		this.#reindex();
		return !sameItems(previous, this.#live);
	}

	/** Rebuilds the order of the live turns and the indexes that follow it. */
	#reindex(): void {
		this.#live = this.#order.filter((turnId) => (this.#drafts.get(turnId)?.liveEvents ?? 0) > 0);
		this.#position = new Map(this.#live.map((turnId, index) => [turnId, index]));
		this.#callTurns = new Map();
		this.#namedBy = new Map();
		this.#steerTurn = new Map();
		for (const turnId of this.#live)
			this.#indexDraft(turnId, this.#drafts.get(turnId) as TurnDraft);
	}

	/** Adds a live turn's calls, names and steers to the indexes; it is the newest live turn. */
	#indexDraft(turnId: string, draft: TurnDraft): void {
		for (const [id] of draft.calls) {
			const turns = this.#callTurns.get(id);
			if (turns === undefined) this.#callTurns.set(id, [turnId]);
			else turns.push(turnId);
		}
		// A name the turn's own call answers never reads another turn, so only the others are kept.
		for (const row of draft.rows) {
			if (row.revertedAt !== null) continue;
			for (const id of rowNames(row)) if (!draft.calls.has(id)) addTo(this.#namedBy, id, turnId);
		}
		for (const steer of draft.steers) this.#steerTurn.set(steer.messageId, turnId);
	}

	/** Records that `turnId`, the newest live turn to hold it, holds a call with this id. */
	#addCallTurn(id: string, turnId: string): void {
		const turns = this.#callTurns.get(id);
		if (turns === undefined) {
			this.#callTurns.set(id, [turnId]);
			return;
		}
		const at = this.#position.get(turnId) ?? Number.POSITIVE_INFINITY;
		let index = turns.length;
		while (index > 0 && (this.#position.get(turns[index - 1] as string) ?? 0) > at) index -= 1;
		turns.splice(index, 0, turnId);
	}

	/**
	 * Places the entries of every turn in `invalid`, in turn order, and of every later turn whose
	 * placement a moved call reaches. Every turn a placement adds or loses work in goes to `dirty`.
	 */
	#settlePlacements(invalid: Set<string>, dirty: Set<string>): void {
		const pending = new Set<string>();
		const queue = new PositionQueue((turnId) => this.#position.get(turnId) ?? 0);
		const wait = (turnId: string) => {
			if (pending.has(turnId)) return;
			pending.add(turnId);
			queue.push(turnId);
		};
		for (const turnId of invalid) if (this.#position.has(turnId)) wait(turnId);
		while (pending.size > 0) {
			const next = queue.pop() as string;
			// Worked out already, as an earlier card of a turn placed before it.
			if (!pending.has(next)) continue;
			pending.delete(next);
			const before = this.#placements.get(next);
			this.#forgetPlacement(next);
			const after = this.#place(next, pending);
			// A turn whose work this turn sends there changed builds again; a new draft's entries are
			// all new, so every turn it reaches builds again.
			for (const root of new Set([...(before?.roots ?? []), ...after.roots])) {
				if (
					before === undefined ||
					before.draft !== after.draft ||
					!sameItems(workFor(before, root), workFor(after, root))
				) {
					dirty.add(root);
				}
			}
			// A call whose card moved takes the work of every later turn that names it along.
			const position = this.#position.get(next) ?? 0;
			const ids = new Set([...(before?.callRoots.keys() ?? []), ...after.callRoots.keys()]);
			for (const id of ids) {
				if (before !== undefined && before.callRoots.get(id) === after.callRoots.get(id)) continue;
				for (const turnId of this.#namedBy.get(id) ?? []) {
					if ((this.#position.get(turnId) ?? -1) > position) wait(turnId);
				}
			}
		}
	}

	#forgetPlacement(turnId: string): void {
		const old = this.#placements.get(turnId);
		if (old === undefined) return;
		for (const root of old.roots) {
			const contributors = this.#contributors.get(root);
			contributors?.delete(turnId);
			if (contributors?.size === 0) this.#contributors.delete(root);
		}
		for (const id of old.consulted) {
			const turns = this.#consultedBy.get(id);
			turns?.delete(turnId);
			if (turns?.size === 0) this.#consultedBy.delete(id);
		}
		this.#placements.delete(turnId);
	}

	/** The placement of a live turn, worked out first when it is waiting in `pending`. */
	#placementOf(turnId: string, pending: Set<string>): Placement {
		const kept = this.#placements.get(turnId);
		if (kept !== undefined && !pending.has(turnId)) return kept;
		pending.delete(turnId);
		this.#forgetPlacement(turnId);
		return this.#place(turnId, pending);
	}

	/** The newest live turn before `position` that holds a call with this id. */
	#earlierCall(id: string, position: number): { turn: string; draft: TurnDraft } | undefined {
		const turns = this.#callTurns.get(id);
		if (turns === undefined) return undefined;
		for (let index = turns.length - 1; index >= 0; index -= 1) {
			const turnId = turns[index] as string;
			if ((this.#position.get(turnId) ?? Number.POSITIVE_INFINITY) < position) {
				return { turn: turnId, draft: this.#drafts.get(turnId) as TurnDraft };
			}
		}
		return undefined;
	}

	#place(turnId: string, pending: Set<string>): Placement {
		const draft = this.#drafts.get(turnId) as TurnDraft;
		const position = this.#position.get(turnId) ?? 0;
		const entries: (Target | null)[] = new Array(draft.entries.length).fill(null);
		const settled: boolean[] = new Array(draft.entries.length).fill(false);
		const roots = new Set<string>([turnId]);
		const top: Target = { root: turnId, holder: null };
		let consulted: Set<string> | undefined;

		// A call of a turn the chat has not loaded holds its late work and its result in that turn's
		// card, as a build of every turn would, so this turn shows neither (CHAT-06, D129).
		const heldElsewhere = (id: string): boolean =>
			!draft.calls.has(id) &&
			this.#earlierCall(id, position) === undefined &&
			this.#callsNotLoaded.has(id);

		/**
		 * The card that should hold an entry, or undefined when it belongs at the top level. A call
		 * in the same turn comes first, then one in an earlier turn. A missing parent, an entry that
		 * names itself, and a parent chain that loops (within a turn or across turns) all keep it at
		 * the top level, so nothing disappears from the chat.
		 */
		const holderOf = (parentId: string, selfId: string | undefined): CallRef | undefined => {
			if (selfId !== undefined && parentId === selfId) return undefined;
			const own = draft.calls.get(parentId);
			let holder: CallRef | undefined;
			if (own !== undefined) holder = { turn: turnId, entry: own };
			else {
				const earlier = this.#earlierCall(parentId, position);
				if (earlier === undefined) return undefined;
				holder = { turn: earlier.turn, entry: earlier.draft.calls.get(parentId) as number };
			}
			const parentOf = (id: string): string | undefined => {
				if (draft.calls.has(id)) return draft.parents.get(id);
				return this.#earlierCall(id, position)?.draft.parents.get(id);
			};
			const seen = new Set<string>(selfId === undefined ? [] : [selfId]);
			let current: string | undefined = parentId;
			while (current !== undefined) {
				if (seen.has(current)) return undefined;
				seen.add(current);
				if (consulted === undefined) consulted = new Set();
				consulted.add(current);
				current = parentOf(current);
			}
			return holder;
		};

		/** The turn a card shows in, or null when the card itself shows nowhere. */
		const rootOf = (ref: CallRef): string | null => {
			if (ref.turn === turnId) return targetOf(ref.entry)?.root ?? null;
			return this.#placementOf(ref.turn, pending).entries[ref.entry]?.root ?? null;
		};

		const targetOf = (index: number): Target | null => {
			if (settled[index] === true) return entries[index] ?? null;
			// An entry met again while its own card is being found: its chain loops, so it stays put.
			settled[index] = true;
			entries[index] = top;
			const entry = draft.entries[index] as Entry;
			let target: Target | null;
			if (entry.kind === "block" && entry.signInEcho === true && draft.claudeSignInResult) {
				target = null;
			} else if (entry.parent !== undefined && heldElsewhere(entry.parent)) {
				target = null;
			} else {
				const selfId = entry.kind === "tool" ? entry.item.toolUseId : undefined;
				const holder = entry.parent === undefined ? undefined : holderOf(entry.parent, selfId);
				if (holder === undefined) target = top;
				else {
					const root = rootOf(holder);
					target = root === null ? null : { root, holder };
				}
			}
			entries[index] = target;
			return target;
		};

		for (let index = 0; index < draft.entries.length; index += 1) {
			const target = targetOf(index);
			if (target !== null) roots.add(target.root);
		}

		// A result for a call of an earlier turn (a background helper's call finishing late) goes to
		// that call. A result whose call never arrived would otherwise be dropped without a trace.
		const results: Placement["results"] = [];
		for (const [id, item] of draft.results) {
			if (draft.calls.has(id)) continue;
			const earlier = this.#earlierCall(id, position);
			if (earlier !== undefined) {
				const target = { turn: earlier.turn, entry: earlier.draft.calls.get(id) as number };
				const root = this.#placementOf(earlier.turn, pending).entries[target.entry]?.root ?? null;
				if (root !== null) {
					results.push({ item, target, root });
					roots.add(root);
				}
				continue;
			}
			if (heldElsewhere(id)) continue;
			results.push({ item, target: null, root: turnId });
		}

		const callRoots = new Map<string, string | null>();
		const ownResults: [number, ToolResultItem][] = [];
		for (const [id, entry] of draft.calls) {
			callRoots.set(id, entries[entry]?.root ?? null);
			const result = draft.results.get(id);
			if (result !== undefined) ownResults.push([entry, result]);
		}
		const placement: Placement = {
			entries,
			results,
			roots: [...roots],
			consulted: consulted === undefined ? NO_IDS : [...consulted],
			callRoots,
			draft,
			ownResults,
		};
		this.#placements.set(turnId, placement);
		for (const root of roots) if (root !== turnId) addTo(this.#contributors, root, turnId);
		for (const id of consulted ?? []) addTo(this.#consultedBy, id, turnId);
		return placement;
	}

	/** Builds one turn from its draft and every later turn's work that shows in it. */
	#build(turnId: string, liveState: LiveState): ChatTurn {
		const draft = this.#drafts.get(turnId) as TurnDraft;
		const contributors = [turnId, ...(this.#contributors.get(turnId) ?? [])].sort(
			(a, b) => (this.#position.get(a) ?? 0) - (this.#position.get(b) ?? 0),
		);
		const cards = new Map<string, ToolCallView>();
		const cardOf = (ref: CallRef): ToolCallView => {
			const key = refKey(ref);
			let card = cards.get(key);
			if (card === undefined) {
				const entry = (this.#drafts.get(ref.turn) as TurnDraft).entries[ref.entry] as Extract<
					Entry,
					{ kind: "tool" }
				>;
				card = { toolUseId: entry.item.toolUseId, item: entry.item, result: null, blocks: [] };
				cards.set(key, card);
			}
			return card;
		};

		const blocks: ChatBlock[] = [];
		for (const from of contributors) {
			const source = this.#drafts.get(from) as TurnDraft;
			const placement = this.#placements.get(from);
			if (placement === undefined) continue;
			for (const [id, entry] of source.calls) {
				const result = source.results.get(id);
				if (result !== undefined && placement.entries[entry]?.root === turnId) {
					cardOf({ turn: from, entry }).result = result;
				}
			}
			source.entries.forEach((entry, index) => {
				const target = placement.entries[index];
				if (target === null || target === undefined || target.root !== turnId) return;
				const block: ChatBlock =
					entry.kind === "block"
						? entry.block
						: { kind: "tool", call: cardOf({ turn: from, entry: index }) };
				if (target.holder === null) blocks.push(block);
				else cardOf(target.holder).blocks.push(block);
			});
			for (const result of placement.results) {
				if (result.root !== turnId) continue;
				if (result.target !== null) {
					cardOf(result.target).result = result.item;
					continue;
				}
				blocks.push({
					kind: "notice",
					item: {
						kind: "notice",
						notice: "info",
						text: `Tool result for an unknown call: ${result.item.toolUseId}`,
					},
				});
			}
		}

		const isLast = this.#live.at(-1) === turnId;
		const outcome: ChatTurn["outcome"] =
			draft.end?.outcome ?? (isLast && liveState.status === "working" ? "running" : "interrupted");

		return {
			turnId: draft.turnId,
			startedBy: draft.userMessage === null ? "agent" : "user",
			userMessage: draft.userMessage,
			steers: draft.steers.map((steer) => ({
				...steer,
				consumed: !liveState.pendingSteerIds.includes(steer.messageId),
			})),
			blocks,
			startCheckpointId: draft.startCheckpointId,
			endCheckpointId: draft.endCheckpointId,
			changes: draft.changes,
			outcome,
			error: draft.end?.error ?? null,
			startedAt: draft.startedAt,
			endedAt: draft.end?.at ?? null,
			usage: draft.usage,
			reverted: draft.reverted,
		};
	}

	/** The turns with the sends not stored yet laid over them. */
	#withPending(turns: ChatTurn[], pendingSends: readonly PendingSend[]): ChatTurn[] {
		if (pendingSends.length === 0) return turns;
		const shown = [...turns];
		const stored = new Set<string>();
		for (const turnId of this.#live) {
			for (const id of (this.#drafts.get(turnId) as TurnDraft).messageIds) stored.add(id);
		}
		for (const send of pendingSends) {
			if (stored.has(send.messageId)) continue;
			stored.add(send.messageId);
			const running = shown.at(-1);
			if (send.delivery === "steer" && running !== undefined) {
				shown[shown.length - 1] = {
					...running,
					steers: [
						...running.steers,
						{ messageId: send.messageId, text: send.text, at: send.at, consumed: false },
					],
				};
				continue;
			}
			shown.push({
				turnId: send.messageId as unknown as ChatTurn["turnId"],
				startedBy: "user",
				userMessage: {
					messageId: send.messageId,
					text: send.text,
					attachmentPaths: [],
					at: send.at,
					sender: null,
				},
				steers: [],
				blocks: [],
				startCheckpointId: null,
				endCheckpointId: null,
				changes: [],
				outcome: "running",
				error: null,
				startedAt: send.at,
				endedAt: null,
				usage: null,
				reverted: false,
			});
		}
		return shown;
	}
}

/**
 * What a placement sends to one turn, as a list two placements of one draft compare item by item:
 * where each entry goes, and each result that reaches a card there, by the result itself.
 */
function workFor(placement: Placement, root: string): unknown[] {
	const parts: unknown[] = [];
	placement.entries.forEach((target, index) => {
		if (target?.root !== root) return;
		parts.push(index, target.holder === null ? "" : refKey(target.holder));
	});
	for (const [entry, result] of placement.ownResults) {
		if (placement.entries[entry]?.root === root) parts.push(entry, result);
	}
	for (const result of placement.results) {
		if (result.root !== root) continue;
		parts.push(result.item, result.target === null ? "" : refKey(result.target));
	}
	return parts;
}

/** Whether two builds of a card show the same: the same call, result and blocks. */
function sameCard(a: ToolCallView, b: ToolCallView): boolean {
	return a.item === b.item && a.result === b.result && sameBlocks(a.blocks, b.blocks);
}

function sameBlocks(a: readonly ChatBlock[], b: readonly ChatBlock[]): boolean {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index += 1) {
		const left = a[index] as ChatBlock;
		const right = b[index] as ChatBlock;
		if (left === right) continue;
		if (left.kind !== "tool" || right.kind !== "tool" || !sameCard(left.call, right.call)) {
			return false;
		}
	}
	return true;
}

/**
 * Whether two builds of a turn show the same. Blocks of text and the like are the draft's own
 * objects, so they compare by identity; cards are built anew and compare by what they hold.
 */
function sameTurn(a: ChatTurn, b: ChatTurn): boolean {
	return (
		a.turnId === b.turnId &&
		a.startedBy === b.startedBy &&
		a.userMessage === b.userMessage &&
		a.steers.length === b.steers.length &&
		a.steers.every((steer, index) => {
			const other = b.steers[index];
			return (
				other !== undefined &&
				steer.messageId === other.messageId &&
				steer.text === other.text &&
				steer.at === other.at &&
				steer.consumed === other.consumed
			);
		}) &&
		sameBlocks(a.blocks, b.blocks) &&
		a.startCheckpointId === b.startCheckpointId &&
		a.endCheckpointId === b.endCheckpointId &&
		a.changes === b.changes &&
		a.outcome === b.outcome &&
		a.error === b.error &&
		a.startedAt === b.startedAt &&
		a.endedAt === b.endedAt &&
		a.usage === b.usage &&
		a.reverted === b.reverted
	);
}

function symmetricDifference(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
	const out: string[] = [];
	for (const id of a) if (!b.has(id)) out.push(id);
	for (const id of b) if (!a.has(id)) out.push(id);
	return out;
}

/** Whether two lists of sends show the same: compared by what each send shows. */
function samePending(a: readonly PendingSend[], b: readonly PendingSend[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((send, index) => {
		const other = b[index] as PendingSend;
		return (
			send.messageId === other.messageId &&
			send.text === other.text &&
			send.at === other.at &&
			send.delivery === other.delivery
		);
	});
}

/** Builds the chat's turns from its stored events once: a new builder's first update. */
export function buildTurns(
	events: readonly StoredEvent[],
	liveState: LiveState,
	pendingSends: readonly PendingSend[] = NO_SENDS,
	callsNotLoaded: ReadonlySet<string> = NO_CALLS,
): ChatTurn[] {
	return new TurnBuilder().update(events, liveState, pendingSends, callsNotLoaded);
}

/**
 * The tool-use ids the events name, as a parent or as a result, that none of their own calls has.
 * When the events are a chat's last turns, these may be calls of an earlier turn (CHAT-06, D129).
 */
export function callsNamedButMissing(events: readonly StoredEvent[]): string[] {
	const calls = new Set<string>();
	const named = new Set<string>();
	for (const row of events) {
		if (row.revertedAt !== null || row.event.type !== "agent") continue;
		const message = row.event.message;
		if (message.parentToolUseId !== undefined) named.add(message.parentToolUseId);
		for (const item of message.items) {
			if (item.kind === "tool_call") {
				calls.add(item.toolUseId);
				if (item.parentToolUseId !== undefined) named.add(item.parentToolUseId);
			} else if (item.kind === "tool_result") {
				named.add(item.toolUseId);
			}
		}
	}
	return [...named].filter((id) => !calls.has(id));
}
