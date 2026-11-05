/**
 * @feature SIDE-05 Event batching and live-state notifications
 * Owns: collecting a chat's events, grouping them into batches, writing each batch to the
 * write-ahead log, and only then sending the events to the app.
 * Behaviour: research/conductor/sessions.md section 5 steps 2 to 4 (a single-flight drain loop
 * batches consecutive notifications, up to 50 events or about 838 860 bytes, and retries a failed
 * send with delays 250, 1000, 5000, 15000, 30000 and 60000 ms).
 * Must handle:
 *  - batch limits: at most 50 events and 838 860 bytes (80 percent of 1 MiB); one event larger than
 *    the byte limit still goes out alone
 *  - write before send: the batch is appended to the outbox first; events that failed to write are
 *    never sent
 *  - a failed outbox write: retry with the delay table, keep order, surface the error after the
 *    last delay as the chat's live-state error instead of dropping events, and log "has not
 *    settled" every 60 seconds while the batch is still stuck
 *  - a notification above the byte limit is shortened: long strings keep a head and a tail around
 *    a note with the original size, and large structured values become a small stub
 *  - the app is disconnected: events stay in the outbox and are replayed on attach (SIDE-06)
 *  - single flight: one drain loop per chat, so events leave in the order they arrived
 *  - flush(): resolves when everything queued before the call has been written and sent; the live
 *    state store waits on it before it publishes a change, so a live-state notification always
 *    follows the events queued before it (sessions 5 step 3)
 * Test first: takeBatches on 120 small events returns 50, 50 and 20 in order.
 * Our design choice: a batch is a write unit, not a wire unit. It groups one append to the
 * write-ahead log. Each event still goes to the app as its own sessionEvent notification.
 * Our design choice: the retry table applies to the local write-ahead append. In Conductor it
 * guarded the socket send, which in our design cannot lose data because the log holds the events.
 */
import type { SessionEvent, SessionEventEnvelope } from "@conducted/protocol";
import type { Clock, SessionId } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { EventOutbox } from "../outbox/event-outbox.ts";
import type { SidecarToApp } from "../rpc/types.ts";

export const MAX_BATCH_EVENTS = 50;
/** 80 percent of 1 MiB, leaving room for the envelope. */
export const MAX_BATCH_BYTES = Math.floor(1024 * 1024 * 0.8);
export const WRITE_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 5000, 15000, 30000, 60000];

const STUCK_WARNING_MS = 60_000;
const STRUCTURED_STUB_MIN_BYTES = 1024;

const encoder = new TextEncoder();

/** UTF-8 size of the JSON form of a value. */
export function jsonBytes(value: unknown): number {
	const text = JSON.stringify(value);
	return text === undefined ? 0 : encoder.encode(text).length;
}

export interface SizedEvent {
	event: SessionEvent;
	/** UTF-8 size of the JSON form of the event. */
	bytes: number;
}

/** Splits queued events into batches that respect both limits, keeping order. */
export function takeBatches(
	events: readonly SizedEvent[],
	limits: { maxEvents: number; maxBytes: number } = {
		maxEvents: MAX_BATCH_EVENTS,
		maxBytes: MAX_BATCH_BYTES,
	},
): SizedEvent[][] {
	const batches: SizedEvent[][] = [];
	let current: SizedEvent[] = [];
	let currentBytes = 0;
	for (const item of events) {
		const full =
			current.length >= limits.maxEvents ||
			(current.length > 0 && currentBytes + item.bytes > limits.maxBytes);
		if (full) {
			batches.push(current);
			current = [];
			currentBytes = 0;
		}
		current.push(item);
		currentBytes += item.bytes;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

// ---------------------------------------------------------------- shortening

function shrinkNote(originalBytes: number): string {
	return `\n\n…[shortened from ${originalBytes} bytes]…\n\n`;
}

function structuredStub(originalBytes: number): Record<string, unknown> {
	return { truncated: true, originalBytes, note: "shortened from a larger value" };
}

function headEnd(text: string, length: number): number {
	let end = Math.min(Math.max(0, length), text.length);
	if (end > 0 && end < text.length) {
		const last = text.charCodeAt(end - 1);
		if (last >= 0xd800 && last <= 0xdbff) end -= 1;
	}
	return end;
}

function tailStart(text: string, length: number): number {
	let start = Math.max(0, text.length - Math.max(0, length));
	if (start > 0 && start < text.length) {
		const first = text.charCodeAt(start);
		if (first >= 0xdc00 && first <= 0xdfff) start += 1;
	}
	return start;
}

function shrinkString(text: string, budget: number): string {
	if (text.length <= budget) return text;
	const note = shrinkNote(encoder.encode(text).length);
	if (budget <= 0) return note;
	const headLength = Math.floor(budget / 2);
	const tailLength = budget - headLength;
	const head = text.slice(0, headEnd(text, headLength));
	const tail = text.slice(tailStart(text, tailLength));
	return `${head}${note}${tail}`;
}

function shrinkValue(value: unknown, budget: number, key?: string): unknown {
	if (typeof value === "string") return shrinkString(value, budget);
	if (value === null || typeof value !== "object") return value;
	if (key === "raw" || key === "input") {
		const size = jsonBytes(value);
		if (size > Math.max(STRUCTURED_STUB_MIN_BYTES, budget)) return structuredStub(size);
		return value;
	}
	if (Array.isArray(value)) return value.map((item) => shrinkValue(item, budget));
	const out: Record<string, unknown> = {};
	for (const [name, inner] of Object.entries(value)) {
		out[name] = shrinkValue(inner, budget, name);
	}
	return out;
}

function longestString(value: unknown): number {
	if (typeof value === "string") return value.length;
	if (Array.isArray(value)) {
		let longest = 0;
		for (const item of value) longest = Math.max(longest, longestString(item));
		return longest;
	}
	if (value === null || typeof value !== "object") return 0;
	let longest = 0;
	for (const inner of Object.values(value)) longest = Math.max(longest, longestString(inner));
	return longest;
}

/** The smallest event we can send while keeping its shape. */
function minimalEvent(event: SessionEvent, originalBytes: number): SessionEvent {
	const note = shrinkNote(originalBytes);
	switch (event.type) {
		case "agent":
			return {
				...event,
				message: {
					agent: event.message.agent,
					items: [{ kind: "notice", notice: "info", text: note }],
					raw: structuredStub(originalBytes),
				},
			};
		case "user_message":
			return { ...event, text: note, attachmentPaths: [] };
		case "checkpoint": {
			const { changes: _changes, ...rest } = event;
			return rest;
		}
		case "turn_ended":
			return event.error === undefined ? event : { ...event, error: note };
	}
}

/**
 * A notification at or below `maxBytes` is returned unchanged. A larger one keeps as much of its
 * long text as fits: a binary search finds the largest head-and-tail budget that stays under the
 * limit, and large structured values become a stub. A final fallback keeps only the event's shape.
 */
export function shrinkEnvelope(
	envelope: SessionEventEnvelope,
	maxBytes: number = MAX_BATCH_BYTES,
): SessionEventEnvelope {
	const originalBytes = jsonBytes(envelope);
	if (originalBytes <= maxBytes) return envelope;

	let low = 0;
	let high = longestString(envelope.event);
	let best = 0;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate: SessionEventEnvelope = {
			...envelope,
			event: shrinkValue(envelope.event, middle) as SessionEvent,
		};
		if (jsonBytes(candidate) <= maxBytes) {
			best = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}

	const shortened: SessionEventEnvelope = {
		...envelope,
		event: shrinkValue(envelope.event, best) as SessionEvent,
	};
	if (jsonBytes(shortened) <= maxBytes) return shortened;
	return { ...envelope, event: minimalEvent(envelope.event, originalBytes) };
}

// ---------------------------------------------------------------- publisher

export interface EventPublisher {
	/** Queues an event for the chat. Never blocks on the write or the send. */
	publish(sessionId: SessionId, event: SessionEvent): void;
	/** Resolves when all events queued so far are in the log and have been sent (or are pending replay). */
	flush(sessionId: SessionId): Promise<void>;
	/** Reports a write that failed after the last retry. */
	onWriteFailure(listener: (sessionId: SessionId, message: string) => void): void;
}

interface FlushWaiter {
	target: number;
	resolve: () => void;
}

interface ChatQueue {
	events: SizedEvent[];
	enqueued: number;
	written: number;
	waiters: FlushWaiter[];
	draining: boolean;
	scheduled: boolean;
}

export class BatchingEventPublisher implements EventPublisher {
	private readonly chats = new Map<SessionId, ChatQueue>();
	private readonly failureListeners: ((sessionId: SessionId, message: string) => void)[] = [];

	constructor(
		protected readonly deps: {
			outbox: EventOutbox;
			app: SidecarToApp;
			clock: Clock;
			logger: Logger;
			/** Waits between write retries. A parameter so tests do not sleep. */
			sleep(ms: number): Promise<void>;
		},
	) {}

	publish(sessionId: SessionId, event: SessionEvent): void {
		const chat = this.chatFor(sessionId);
		chat.events.push({ event, bytes: jsonBytes(event) });
		chat.enqueued += 1;
		this.scheduleDrain(sessionId, chat);
	}

	flush(sessionId: SessionId): Promise<void> {
		const chat = this.chats.get(sessionId);
		if (chat === undefined || chat.written >= chat.enqueued) return Promise.resolve();
		return new Promise<void>((resolve) => {
			chat.waiters.push({ target: chat.enqueued, resolve });
			this.scheduleDrain(sessionId, chat);
		});
	}

	onWriteFailure(listener: (sessionId: SessionId, message: string) => void): void {
		this.failureListeners.push(listener);
	}

	private chatFor(sessionId: SessionId): ChatQueue {
		const existing = this.chats.get(sessionId);
		if (existing !== undefined) return existing;
		const chat: ChatQueue = {
			events: [],
			enqueued: 0,
			written: 0,
			waiters: [],
			draining: false,
			scheduled: false,
		};
		this.chats.set(sessionId, chat);
		return chat;
	}

	/** Starts the chat's drain once the current run of publishes has been queued. */
	private scheduleDrain(sessionId: SessionId, chat: ChatQueue): void {
		if (chat.draining || chat.scheduled) return;
		chat.scheduled = true;
		queueMicrotask(() => {
			chat.scheduled = false;
			void this.drain(sessionId).catch((cause: unknown) => {
				this.deps.logger.error("The event drain failed", {
					sessionId,
					reason: cause instanceof Error ? cause.message : String(cause),
				});
			});
		});
	}

	/**
	 * One loop per chat. It sends at most up to the oldest waiting flush, so a live-state
	 * notification (which waits on that flush) is never overtaken by later events.
	 */
	private async drain(sessionId: SessionId): Promise<void> {
		const chat = this.chats.get(sessionId);
		if (chat === undefined || chat.draining) return;
		chat.draining = true;
		let stopForBoundary = false;
		try {
			while (chat.events.length > 0) {
				const boundary = this.nextBoundary(chat);
				const available =
					boundary === undefined
						? chat.events.length
						: Math.min(chat.events.length, boundary - chat.written);
				if (available <= 0) {
					stopForBoundary = this.resolveWaiters(chat);
					if (stopForBoundary) break;
					continue;
				}
				const sending = chat.events.slice(0, available);
				chat.events = chat.events.slice(available);
				for (const batch of takeBatches(sending)) {
					const envelopes = await this.appendBatch(
						sessionId,
						batch.map((item) => item.event),
					);
					for (const envelope of envelopes) this.send(envelope);
					chat.written += batch.length;
				}
				stopForBoundary = this.resolveWaiters(chat);
				if (stopForBoundary) break;
			}
		} finally {
			chat.draining = false;
			this.maybeForget(sessionId, chat);
		}
		if (stopForBoundary && chat.events.length > 0) {
			queueMicrotask(() => {
				void this.drain(sessionId).catch((cause: unknown) => {
					this.deps.logger.error("The event drain failed", {
						sessionId,
						reason: cause instanceof Error ? cause.message : String(cause),
					});
				});
			});
		}
	}

	private nextBoundary(chat: ChatQueue): number | undefined {
		let boundary: number | undefined;
		for (const waiter of chat.waiters) {
			if (waiter.target <= chat.written) continue;
			boundary = boundary === undefined ? waiter.target : Math.min(boundary, waiter.target);
		}
		return boundary;
	}

	private resolveWaiters(chat: ChatQueue): boolean {
		const remaining: FlushWaiter[] = [];
		let resolved = false;
		for (const waiter of chat.waiters) {
			if (waiter.target <= chat.written) {
				waiter.resolve();
				resolved = true;
			} else {
				remaining.push(waiter);
			}
		}
		chat.waiters = remaining;
		return resolved;
	}

	private maybeForget(sessionId: SessionId, chat: ChatQueue): void {
		if (chat.draining || chat.events.length > 0 || chat.waiters.length > 0) return;
		if (this.chats.get(sessionId) === chat) this.chats.delete(sessionId);
	}

	private async appendBatch(
		sessionId: SessionId,
		events: readonly SessionEvent[],
	): Promise<SessionEventEnvelope[]> {
		let failures = 0;
		let reported = false;
		while (true) {
			const result = await this.deps.outbox.append(sessionId, events);
			if (result.ok) return result.value;
			const message = result.error.message;
			const delay =
				WRITE_RETRY_DELAYS_MS[Math.min(failures, WRITE_RETRY_DELAYS_MS.length - 1)] ??
				STUCK_WARNING_MS;
			if (failures >= WRITE_RETRY_DELAYS_MS.length) {
				this.deps.logger.warn("The event batch has not settled", {
					sessionId,
					at: this.deps.clock.now(),
					events: events.length,
					reason: message,
				});
				if (!reported) {
					reported = true;
					for (const listener of this.failureListeners) listener(sessionId, message);
				}
			}
			await this.deps.sleep(delay);
			failures += 1;
		}
	}

	private send(envelope: SessionEventEnvelope): void {
		this.deps.app.notify("sessionEvent", shrinkEnvelope(envelope, MAX_BATCH_BYTES));
	}
}
