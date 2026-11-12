/**
 * @feature CHAT-07 Turn builder: stored events to chat turns
 * Owns: grouping a chat's events into turns for the chat list, pairing tool calls with their
 * results, nesting sub-agent work under the call that started it, and keeping each unchanged turn
 * the same object between builds.
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
 * (renderApp kpa @9558460).
 * Our design choice: the builder is a pure function of events and live state. Every call walks the
 * stored events and rebuilds the turns, in time linear in the events: turns are finished in order,
 * and each finished turn's calls go into one index that later turns look up. Conductor builds each
 * turn from its own rows only and shows a sub-agent's work from a later turn nowhere (main `wp`
 * @1423850, `_mt` @1427823); we show it in the card that started it, by the owner's ruling (D129).
 * Because a past turn can change, `reuseUnchangedTurns` matches turns by id and fingerprint, so the
 * list redraws every turn that changed and no other.
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
	| { kind: "tool"; call: ToolCallView; parent: string | undefined };

interface TurnDraft {
	turnId: ChatTurn["turnId"];
	userMessage: ChatTurn["userMessage"];
	steers: ChatTurn["steers"];
	entries: Entry[];
	/** Every call in the turn, by tool-use id, whether top-level or nested. */
	calls: Map<string, ToolCallView>;
	/** The call each nested call belongs to, by tool-use id. */
	parents: Map<string, string>;
	/** Results seen before their call could be paired with it. */
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
}

function emptyDraft(turnId: ChatTurn["turnId"], at: number): TurnDraft {
	return {
		turnId,
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
			const call: ToolCallView = {
				toolUseId: item.toolUseId,
				item,
				result: null,
				blocks: [],
			};
			draft.calls.set(item.toolUseId, call);
			if (owner !== undefined) draft.parents.set(item.toolUseId, owner);
			draft.entries.push({ kind: "tool", call, parent: owner });
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

function applyEvent(draft: TurnDraft, event: SessionEvent, liveState: LiveState): void {
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
			draft.steers.push({
				messageId: event.messageId,
				text: event.text,
				at: event.at,
				consumed: !liveState.pendingSteerIds.includes(event.messageId),
			});
			return;
		case "agent": {
			const message = event.message;
			const echo = isSignInEcho(message);
			const first = draft.entries.length;
			for (const item of message.items) {
				applyItem(draft, item, message.parentToolUseId);
			}
			if (echo) {
				for (const entry of draft.entries.slice(first)) {
					if (entry.kind === "block") entry.signInEcho = true;
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

/**
 * The calls of the turns finalised so far, by tool-use id, with the call each one belongs to. A
 * later turn looks here for the card a background helper's late work belongs in (D129).
 */
interface EarlierCalls {
	calls: Map<string, ToolCallView>;
	parents: Map<string, string>;
}

/** Adds a finalised turn's calls to the index. A later call with the same id replaces the earlier. */
function rememberCalls(earlier: EarlierCalls, draft: TurnDraft): void {
	for (const [toolUseId, call] of draft.calls) {
		earlier.calls.set(toolUseId, call);
		const parent = draft.parents.get(toolUseId);
		if (parent === undefined) earlier.parents.delete(toolUseId);
		else earlier.parents.set(toolUseId, parent);
	}
}

/**
 * The call that should hold an entry, or undefined when it belongs at the top level. A call in the
 * same turn comes first, then one in an earlier turn. A missing parent, an entry that names itself,
 * and a parent chain that loops (within a turn or across turns) all keep it at the top level, so
 * nothing disappears from the chat.
 */
function holderCall(
	draft: TurnDraft,
	earlier: EarlierCalls,
	parentId: string,
	selfId: string | undefined,
): ToolCallView | undefined {
	if (selfId !== undefined && parentId === selfId) return undefined;
	const parent = draft.calls.get(parentId) ?? earlier.calls.get(parentId);
	if (parent === undefined) return undefined;

	const parentOf = (id: string): string | undefined =>
		draft.calls.has(id) ? draft.parents.get(id) : earlier.parents.get(id);
	const seen = new Set<string>(selfId === undefined ? [] : [selfId]);
	let current: string | undefined = parentId;
	while (current !== undefined) {
		if (seen.has(current)) return undefined;
		seen.add(current);
		current = parentOf(current);
	}
	return parent;
}

function finalize(
	draft: TurnDraft,
	earlier: EarlierCalls,
	liveState: LiveState,
	isLast: boolean,
): ChatTurn {
	for (const [toolUseId, call] of draft.calls) {
		const result = draft.results.get(toolUseId);
		if (result !== undefined) call.result = result;
	}

	// Keep a sub-agent's blocks and calls inside the call that started it, in this turn or an
	// earlier one; late work lands after what the card already holds. An entry whose parent is
	// missing or whose parent chain loops stays at the top level, so every call still renders.
	const blocks: ChatBlock[] = [];
	for (const entry of draft.entries) {
		if (entry.kind === "block" && entry.signInEcho === true && draft.claudeSignInResult) continue;
		const selfId = entry.kind === "tool" ? entry.call.toolUseId : undefined;
		const parent =
			entry.parent === undefined ? undefined : holderCall(draft, earlier, entry.parent, selfId);
		if (parent === undefined) {
			blocks.push(entry.kind === "block" ? entry.block : { kind: "tool", call: entry.call });
		} else if (entry.kind === "block") {
			parent.blocks.push(entry.block);
		} else {
			parent.blocks.push({ kind: "tool", call: entry.call });
		}
	}

	// A result for a call of an earlier turn (a background helper's call finishing late) goes to
	// that call. A result whose call never arrived would otherwise be dropped without a trace.
	for (const [toolUseId, result] of draft.results) {
		if (draft.calls.has(toolUseId)) continue;
		const earlierCall = earlier.calls.get(toolUseId);
		if (earlierCall !== undefined) {
			earlierCall.result = result;
			continue;
		}
		blocks.push({
			kind: "notice",
			item: {
				kind: "notice",
				notice: "info",
				text: `Tool result for an unknown call: ${toolUseId}`,
			},
		});
	}

	const outcome: ChatTurn["outcome"] =
		draft.end?.outcome ?? (isLast && liveState.status === "working" ? "running" : "interrupted");

	return {
		turnId: draft.turnId,
		startedBy: draft.userMessage === null ? "agent" : "user",
		userMessage: draft.userMessage,
		steers: draft.steers,
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

/**
 * Builds the chat's turns from its stored events. Pending sends are a second overlay: a message
 * whose `user_message` event has not been stored yet appears as a running turn at the end. A
 * pending steer is added to the last turn's steers instead, as not yet read.
 */
export function buildTurns(
	events: readonly StoredEvent[],
	liveState: LiveState,
	pendingSends: readonly PendingSend[] = [],
): ChatTurn[] {
	const drafts = new Map<string, TurnDraft>();
	const order: TurnDraft[] = [];
	const storedMessageIds = new Set<string>();

	for (const row of events) {
		const turnId = row.event.turnId;
		let draft = drafts.get(turnId);
		if (draft === undefined) {
			draft = emptyDraft(turnId, row.event.at);
			drafts.set(turnId, draft);
			order.push(draft);
		}
		draft.startedAt = Math.min(draft.startedAt, row.event.at);

		if (row.revertedAt !== null) {
			// The turn keeps the events that were not reverted, and says it was partly undone.
			draft.reverted = true;
			continue;
		}
		if (row.event.type === "user_message") storedMessageIds.add(row.event.messageId);

		draft.liveEvents += 1;
		applyEvent(draft, row.event, liveState);
	}

	const liveTurns = order.filter((draft) => draft.liveEvents > 0);
	const earlier: EarlierCalls = { calls: new Map(), parents: new Map() };
	const turns = liveTurns.map((draft, index) => {
		const turn = finalize(draft, earlier, liveState, index === liveTurns.length - 1);
		rememberCalls(earlier, draft);
		return turn;
	});

	for (const send of pendingSends) {
		if (storedMessageIds.has(send.messageId)) continue;
		storedMessageIds.add(send.messageId);
		const running = turns.at(-1);
		if (send.delivery === "steer" && running !== undefined) {
			running.steers = [
				...running.steers,
				{ messageId: send.messageId, text: send.text, at: send.at, consumed: false },
			];
			continue;
		}
		turns.push({
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

	return turns;
}

/**
 * A stable text fingerprint of everything a turn shows. Two builds of the same settled turn
 * produce the same string, so the view keeps the earlier object.
 */
function fingerprint(turn: ChatTurn): string {
	return JSON.stringify({
		turnId: turn.turnId,
		startedBy: turn.startedBy,
		userMessage: turn.userMessage,
		steers: turn.steers,
		blocks: turn.blocks,
		startCheckpointId: turn.startCheckpointId,
		endCheckpointId: turn.endCheckpointId,
		changes: turn.changes,
		outcome: turn.outcome,
		error: turn.error,
		startedAt: turn.startedAt,
		endedAt: turn.endedAt,
		usage: turn.usage,
		reverted: turn.reverted,
	});
}

/**
 * The turn list for the view. Each turn that shows the same as in the last build is that build's
 * object, so a memoised list item skips it; a changed or new turn is the new object. Turns are
 * matched by id rather than by position from the start, because a past turn changes when a
 * background helper's late work reaches its card (D129), while the turns after it stay as they were.
 */
export function reuseUnchangedTurns(
	previous: readonly ChatTurn[],
	next: readonly ChatTurn[],
): ChatTurn[] {
	if (previous.length === 0) return [...next];
	const before = new Map(previous.map((turn) => [turn.turnId, turn]));
	return next.map((turn) => {
		const old = before.get(turn.turnId);
		return old !== undefined && fingerprint(old) === fingerprint(turn) ? old : turn;
	});
}
