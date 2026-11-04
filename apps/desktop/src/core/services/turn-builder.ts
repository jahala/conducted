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
import type { LiveState, SessionEvent } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { ChatTurn } from "../model.ts";

/** One row of `session_events` as the chat sees it. */
export interface StoredEvent {
	idx: number;
	event: SessionEvent;
	receivedAt: number;
	revertedAt: number | null;
}

export function buildTurns(_events: readonly StoredEvent[], _liveState: LiveState): ChatTurn[] {
	return notImplemented("CHAT-07");
}

export type TurnsChange =
	| { kind: "initial" }
	| { kind: "same" }
	| { kind: "appended"; fromIndex: number }
	| { kind: "tail_changed"; fromIndex: number }
	| { kind: "truncated"; toLength: number }
	| { kind: "inserted"; atIndex: number }
	| { kind: "cleared" };

/** Compares two builds of the turn list so the list view can re-render only what changed. */
export function classifyTurnsChange(
	_previous: readonly ChatTurn[],
	_next: readonly ChatTurn[],
): TurnsChange {
	return notImplemented("CHAT-07");
}
