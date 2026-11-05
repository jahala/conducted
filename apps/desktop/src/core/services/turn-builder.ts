/**
 * @feature CHAT-07 Turn builder: stored events to chat turns
 * Owns: grouping a chat's events into turns for the chat list, pairing tool calls with their
 * results, nesting sub-agent calls, and telling the list how the turns changed.
 * Behaviour: frontend.md 5 (turn building, sub-agent buckets, incremental differ), sessions.md 5
 * (event types), sessions-and-chats.md "How chats are stored".
 * Must handle: events arrive in `idx` order but a tool result may arrive in a later event than
 * its call; a call without a result yet is shown as running; a sub-agent's calls carry
 * `parentToolUseId` and nest under that call at any depth; events with `reverted_at` set are
 * left out of the turns (the revert hides them); a steer message belongs to the turn it steered
 * and shows `consumed` once the live state no longer lists it as pending; a turn without a
 * `turn_ended` event while the chat is idle is shown as interrupted; usage items add up per
 * turn; text and thinking items of one message stay in order; unknown item kinds are skipped
 * with a notice block, never a crash.
 * Our design choice: the builder is a pure function of events and live state. The differ
 * compares a cheap fingerprint of every settled turn, so while a reply streams only the last
 * turn is rebuilt and re-rendered.
 * Test first: a tool_call event followed later by its tool_result yields one tool block with both.
 */
import type { AgentItem, LiveState, SessionEvent } from "@conducted/protocol";
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
}

type Entry = { kind: "block"; block: ChatBlock } | { kind: "tool"; call: ToolCallView };

interface TurnDraft {
	turnId: ChatTurn["turnId"];
	userMessage: ChatTurn["userMessage"];
	steers: ChatTurn["steers"];
	entries: Entry[];
	/** Every call in the turn, by tool-use id, whether top-level or nested. */
	calls: Map<string, ToolCallView>;
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
}

function emptyDraft(turnId: ChatTurn["turnId"], at: number): TurnDraft {
	return {
		turnId,
		userMessage: null,
		steers: [],
		entries: [],
		calls: new Map(),
		results: new Map(),
		usage: null,
		startCheckpointId: null,
		endCheckpointId: null,
		changes: [],
		end: null,
		startedAt: at,
		liveEvents: 0,
		reverted: false,
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

function applyItem(draft: TurnDraft, item: AgentItem): void {
	switch (item.kind) {
		case "text":
			draft.entries.push({ kind: "block", block: { kind: "text", text: item.text } });
			return;
		case "thinking":
			draft.entries.push({
				kind: "block",
				block: { kind: "thinking", text: item.text, summarized: item.summarized },
			});
			return;
		case "tool_call": {
			const call: ToolCallView = { toolUseId: item.toolUseId, item, result: null, children: [] };
			draft.calls.set(item.toolUseId, call);
			draft.entries.push({ kind: "tool", call });
			return;
		}
		case "tool_result":
			draft.results.set(item.toolUseId, item);
			return;
		case "todo":
			draft.entries.push({ kind: "block", block: { kind: "todo", item } });
			return;
		case "notice":
			draft.entries.push({ kind: "block", block: { kind: "notice", item } });
			return;
		case "error":
			draft.entries.push({ kind: "block", block: { kind: "error", item } });
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
			});
		}
	}
}

function applyEvent(draft: TurnDraft, event: SessionEvent, liveState: LiveState): void {
	switch (event.type) {
		case "user_message":
			if (event.delivery === "new_turn") {
				if (draft.userMessage === null) {
					draft.userMessage = {
						messageId: event.messageId,
						text: event.text,
						attachmentPaths: event.attachmentPaths,
						at: event.at,
						sender: event.sender ?? null,
					};
				}
				return;
			}
			draft.steers.push({
				messageId: event.messageId,
				text: event.text,
				at: event.at,
				consumed: !liveState.pendingSteerIds.includes(event.messageId),
			});
			return;
		case "agent":
			for (const item of event.message.items) applyItem(draft, item);
			return;
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

function finalize(draft: TurnDraft, liveState: LiveState, isLast: boolean): ChatTurn {
	for (const [toolUseId, call] of draft.calls) {
		const result = draft.results.get(toolUseId);
		if (result !== undefined) call.result = result;
	}

	// Nest a sub-agent call under the call that started it. A call whose parent is missing
	// stays at the top level, so a partial transcript still renders.
	const blocks: ChatBlock[] = [];
	for (const entry of draft.entries) {
		if (entry.kind === "block") {
			blocks.push(entry.block);
			continue;
		}
		const parentId = entry.call.item.parentToolUseId;
		const parent =
			parentId !== undefined && parentId !== entry.call.toolUseId
				? draft.calls.get(parentId)
				: undefined;
		if (parent === undefined) {
			blocks.push({ kind: "tool", call: entry.call });
		} else {
			parent.children.push(entry.call);
		}
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
 * whose `user_message` event has not been stored yet appears as a running turn at the end.
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

		if (row.revertedAt !== null) continue;
		if (row.event.type === "user_message") storedMessageIds.add(row.event.messageId);

		draft.liveEvents += 1;
		applyEvent(draft, row.event, liveState);
	}

	const liveTurns = order.filter((draft) => draft.liveEvents > 0);
	const turns = liveTurns.map((draft, index) =>
		finalize(draft, liveState, index === liveTurns.length - 1),
	);

	for (const send of pendingSends) {
		if (storedMessageIds.has(send.messageId)) continue;
		storedMessageIds.add(send.messageId);
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

export type TurnsChange =
	| { kind: "initial" }
	| { kind: "same" }
	| { kind: "appended"; fromIndex: number }
	| { kind: "tail_changed"; fromIndex: number }
	| { kind: "truncated"; toLength: number }
	| { kind: "inserted"; atIndex: number }
	| { kind: "cleared" };

/**
 * A stable text fingerprint of everything a turn shows. Two builds of the same settled turn
 * produce the same string, so the differ can skip it.
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

/** Compares two builds of the turn list so the list view can re-render only what changed. */
export function classifyTurnsChange(
	previous: readonly ChatTurn[],
	next: readonly ChatTurn[],
): TurnsChange {
	if (previous.length === 0) {
		return next.length === 0 ? { kind: "same" } : { kind: "initial" };
	}
	if (next.length === 0) return { kind: "cleared" };

	let common = 0;
	const shared = Math.min(previous.length, next.length);
	while (common < shared) {
		const before = previous[common];
		const after = next[common];
		if (before === undefined || after === undefined) break;
		if (fingerprint(before) !== fingerprint(after)) break;
		common += 1;
	}

	if (common === previous.length && common === next.length) return { kind: "same" };
	if (common === previous.length && next.length > previous.length) {
		return { kind: "appended", fromIndex: common };
	}
	if (common === next.length && previous.length > next.length) {
		return { kind: "truncated", toLength: next.length };
	}
	if (previous.length === next.length) {
		return { kind: "tail_changed", fromIndex: common };
	}
	// The turn list is neither an extension nor a shortening from the end. Re-render from the
	// first turn that differs.
	return { kind: "inserted", atIndex: common };
}
