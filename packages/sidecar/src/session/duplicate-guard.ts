/**
 * @feature SIDE-03 Session manager: duplicate guard
 * Owns: deciding whether a message id was already seen for a chat, so a retry from the app never
 * runs a turn twice.
 * Behaviour: research/conductor/sessions.md section 2 `kFe` "Duplicate guard": a message is ignored
 * when its id is the running message, is queued, was handled recently (capped at 100), or is still
 * being sent.
 * Must handle: the same id twice in a row, an id that finished long ago (it ages out of the recent
 * set after 100 newer ids, oldest first), a cancelled message (forgotten so the user can resend
 * the same text with a new id), and one guard per chat so ids never cross chats.
 * Test first: after markHandled("m1"), check("m1") is "duplicate"; after 100 other ids, "m1" is
 * "new" again.
 */
import type { MessageId } from "@conducted/shared";

export const RECENT_MESSAGE_CAP = 100;

export type DuplicateVerdict = "new" | "duplicate";

export type DeliveredAs = "new_turn" | "steer" | "queued";

export class DuplicateGuard {
	private running: MessageId | null = null;
	private readonly queued = new Set<MessageId>();
	private readonly inFlight = new Set<MessageId>();
	private readonly recent: MessageId[] = [];
	private readonly deliveries = new Map<MessageId, DeliveredAs>();

	check(id: MessageId): DuplicateVerdict {
		if (this.running === id || this.queued.has(id) || this.inFlight.has(id)) return "duplicate";
		return this.recent.includes(id) ? "duplicate" : "new";
	}

	/** The message is being sent to the runner right now. */
	markInFlight(id: MessageId): void {
		this.inFlight.add(id);
	}

	markQueued(id: MessageId): void {
		this.queued.add(id);
	}

	markRunning(id: MessageId): void {
		this.queued.delete(id);
		this.inFlight.delete(id);
		this.running = id;
	}

	/** The message finished, failed or was cancelled. It stays "duplicate" for the next 100 ids. */
	markHandled(id: MessageId): void {
		this.queued.delete(id);
		this.inFlight.delete(id);
		if (this.running === id) this.running = null;
		this.recent.push(id);
		if (this.recent.length > RECENT_MESSAGE_CAP) {
			const evicted = this.recent.shift();
			if (evicted !== undefined) this.deliveries.delete(evicted);
		}
	}

	/** Forgets a message completely, for example a cancelled queued message. */
	forget(id: MessageId): void {
		this.queued.delete(id);
		this.inFlight.delete(id);
		if (this.running === id) this.running = null;
		const at = this.recent.indexOf(id);
		if (at !== -1) this.recent.splice(at, 1);
		this.deliveries.delete(id);
	}

	/** Drops every steer that is still being sent. Returns the ids so the caller can forget them. */
	cancelInFlight(): MessageId[] {
		const ids = [...this.inFlight];
		for (const id of ids) this.forget(id);
		return ids;
	}

	/** How the message was delivered, for the answer to a repeated send. */
	rememberDelivery(id: MessageId, deliveredAs: DeliveredAs): void {
		this.deliveries.set(id, deliveredAs);
	}

	deliveryOf(id: MessageId): DeliveredAs | undefined {
		return this.deliveries.get(id);
	}
}
