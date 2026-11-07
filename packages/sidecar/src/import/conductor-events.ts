/**
 * @feature APP-18 Conductor's chat events as ours, for the chat history spike
 * Owns: `mapConductorEvents`, which turns one chat's rows of Conductor's session events table into
 * our session events and counts, per Conductor event type, how many it mapped and how many it could
 * not; `visibleSequence`, the order of user and agent messages a chat shows, on both sides.
 * Behaviour: docs/research/conductor/sessions.md section 5 (the durable event types `userMessage`,
 * `agent` and `checkpointCreated`; an agent event carries the agent's raw payload, for Claude the
 * SDK's stream-json message), sessions-and-chats.md ("How chats are stored": `reverted_at`), and
 * services-map.md 2.2 (`session_messages`, the projection Conductor's chat reads). Our events are
 * packages/protocol/src/events.ts. Claude's raw payloads go through `ClaudeTranslator`, the one home
 * of that translation, so a mapped chat reads as a chat our runner wrote.
 * Must handle: content that is not JSON, or JSON of another shape, counts as unmapped and never
 * throws; a queued user message is understood but shows nothing (its sent event is the one shown);
 * a reverted event is counted on its own and left out; an agent payload of an agent other than
 * Claude counts as unmapped until its translator is written; a checkpoint event counts as unmapped,
 * because it names a snapshot under Conductor's own refs, which Conducted does not restore; nothing
 * here logs, so no message text leaves this function except in the events it returns.
 * Our design choice: the mapping lives in the sidecar beside the runners' translators. The import
 * can only bring history once the spike's pass mark is met (D100); this function is what the spike
 * measures (scripts/conductor-import/spike.ts) and what that import will run (D124).
 * Test first: a Claude assistant payload maps to one agent event whose items are its text.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage, SessionConfig, SessionEvent } from "@conducted/protocol";
import type { AgentKind, EventId, MessageId, TurnId } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { ClaudeTranslator } from "../runners/claude/translate.ts";

/** Conductor's durable event types (sessions.md section 5). Any other type counts as "other". */
export const CONDUCTOR_EVENT_TYPES = ["userMessage", "agent", "checkpointCreated"] as const;
export type CountedEventType = (typeof CONDUCTOR_EVENT_TYPES)[number] | "other";

export interface ConductorEventRow {
	event_id: string | null;
	event_type: string | null;
	content: string | null;
	received_at: string | null;
	reverted_at: string | null;
}

export interface TypeCount {
	events: number;
	mapped: number;
	unmapped: number;
}

export interface MappedChat {
	events: SessionEvent[];
	counts: Record<CountedEventType, TypeCount>;
	/** Events Conductor marked reverted: not shown there, so left out here. */
	reverted: number;
}

/** A logger that writes nothing: the translator's debug lines may quote a payload. */
const SILENT: Logger = {
	error: () => {},
	warn: () => {},
	info: () => {},
	debug: () => {},
	child: () => SILENT,
	setLevel: () => {},
};

const emptyCounts = (): Record<CountedEventType, TypeCount> => ({
	userMessage: { events: 0, mapped: 0, unmapped: 0 },
	agent: { events: 0, mapped: 0, unmapped: 0 },
	checkpointCreated: { events: 0, mapped: 0, unmapped: 0 },
	other: { events: 0, mapped: 0, unmapped: 0 },
});

const countedType = (type: string | null): CountedEventType =>
	(CONDUCTOR_EVENT_TYPES as readonly (string | null)[]).includes(type)
		? (type as CountedEventType)
		: "other";

function record(content: string | null): Record<string, unknown> | null {
	if (content === null) return null;
	try {
		const value: unknown = JSON.parse(content);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A Conductor text time, UTC when it names no zone, as milliseconds; 0 when it is no time. */
function timeOf(value: string | null): number {
	if (value === null) return 0;
	const trimmed = value.trim().replace(" ", "T");
	const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`;
	const parsed = Date.parse(zoned);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Maps one chat's events, in `session_index` order. `config` is the chat's config, which our
 * user_message event carries; `agent` picks the translator for its agent payloads.
 */
export function mapConductorEvents(
	rows: readonly ConductorEventRow[],
	chat: { agent: AgentKind; config: SessionConfig },
): MappedChat {
	const counts = emptyCounts();
	const events: SessionEvent[] = [];
	const translator = new ClaudeTranslator({ logger: SILENT });
	let reverted = 0;
	let turnId: TurnId | null = null;
	for (const [index, row] of rows.entries()) {
		const type = countedType(row.event_type);
		if (row.reverted_at !== null) {
			reverted++;
			continue;
		}
		const count = counts[type];
		count.events++;
		const body = record(row.content);
		const eventId = (row.event_id ?? `conductor-event-${index}`) as EventId;
		const at = timeOf(row.received_at);
		const mapped: SessionEvent[] | null =
			body === null
				? null
				: type === "userMessage"
					? userMessage(body, eventId, at, chat.config)
					: type === "agent"
						? agentEvents(body, eventId, at, turnId, chat.agent, translator)
						: null;
		if (mapped === null) {
			count.unmapped++;
			continue;
		}
		count.mapped++;
		for (const event of mapped) {
			if (event.type === "user_message") turnId = event.turnId as TurnId;
			events.push(event);
		}
	}
	return { events, counts, reverted };
}

function userMessage(
	body: Record<string, unknown>,
	eventId: EventId,
	at: number,
	config: SessionConfig,
): SessionEvent[] | null {
	const messageId = text(body.messageId) ?? text(body.userMessageId) ?? text(body.id);
	const typed = text(body.text) ?? text(body.prompt) ?? text(body.message) ?? text(body.content);
	if (messageId === null || typed === null) return null;
	// A queued message is understood: Conductor shows it when its "sent" event arrives.
	if (body.state === "queued") return [];
	return [
		{
			eventId,
			at,
			type: "user_message",
			messageId: messageId as MessageId,
			turnId: (text(body.turnId) ?? messageId) as TurnId,
			text: typed,
			attachmentPaths: [],
			delivery: "new_turn",
			config,
		},
	];
}

function agentEvents(
	body: Record<string, unknown>,
	eventId: EventId,
	at: number,
	currentTurn: TurnId | null,
	agent: AgentKind,
	translator: ClaudeTranslator,
): SessionEvent[] | null {
	const payload = body.rawPayload;
	if (agent !== "claude" || typeof payload !== "object" || payload === null) return null;
	if (typeof (payload as { type?: unknown }).type !== "string") return null;
	const turnId = (text(body.turnId) ?? currentTurn) as TurnId | null;
	if (turnId === null) return null;
	let messages: AgentMessage[];
	try {
		messages = translator.translate(payload as SDKMessage);
	} catch {
		return null;
	}
	return messages.map((message, part) => ({
		eventId: (part === 0 ? eventId : `${eventId}:${part}`) as EventId,
		at,
		type: "agent" as const,
		turnId,
		message,
	}));
}

/** A visible kind: U for a message the user sent, A for one the agent wrote. */
export type VisibleKind = "U" | "A";

const VISIBLE_ITEMS: ReadonlySet<string> = new Set(["text", "thinking", "tool_call", "todo"]);

/** The user and agent messages our chat would show, in order. */
export function visibleSequence(events: readonly SessionEvent[]): VisibleKind[] {
	const out: VisibleKind[] = [];
	for (const event of events) {
		if (event.type === "user_message") out.push("U");
		else if (
			event.type === "agent" &&
			event.message.items.some((item) => VISIBLE_ITEMS.has(item.kind))
		) {
			out.push("A");
		}
	}
	return out;
}

export interface ConductorMessageRow {
	role: string | null;
	sent_at: string | null;
	cancelled_at: string | null;
}

/**
 * The user and agent messages Conductor's chat shows, from its `session_messages` projection: a
 * user row once it was sent and not cancelled, and every assistant row.
 */
export function conductorVisibleSequence(rows: readonly ConductorMessageRow[]): VisibleKind[] {
	const out: VisibleKind[] = [];
	for (const row of rows) {
		if (row.role === "user" && row.sent_at !== null && row.cancelled_at === null) out.push("U");
		else if (row.role === "assistant") out.push("A");
	}
	return out;
}
