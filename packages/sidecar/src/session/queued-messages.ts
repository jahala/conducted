/**
 * @feature SIDE-03 Session manager: in-memory follow-up queue
 * Owns: the messages that arrived while a turn was running and could not be steered. They wait
 * here and start one at a time when the turn ends.
 * Behaviour: research/conductor/sessions.md section 6 "Default delivery while working" (pushed to
 * pendingMessages, a userMessage event with state "queued", popped when the turn ends; a failed
 * queued message is logged and the next one is tried).
 * Must handle: first in, first out; cancel drops the whole queue and tells the caller which
 * message ids were dropped; a queued message keeps the config it was sent with.
 * Test first: enqueue a, b; dequeue gives a then b; clear() returns [a, b] when nothing was
 * dequeued.
 */
import type { MessageId } from "@conducted/shared";
import type { TurnRequest } from "./turn.ts";

export class QueuedMessages {
	private items: TurnRequest[] = [];

	enqueue(request: TurnRequest): void {
		this.items.push(request);
	}

	dequeue(): TurnRequest | undefined {
		return this.items.shift();
	}

	/** Drops everything. Returns the ids so the caller can forget them in the duplicate guard. */
	clear(): MessageId[] {
		const ids = this.items.map((item) => item.messageId);
		this.items = [];
		return ids;
	}

	get size(): number {
		return this.items.length;
	}
}
