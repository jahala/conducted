/**
 * @feature APP-18 Conductor's chat events as ours, for the chat history spike
 * Owns: `mapConductorEvents`, which turns one chat's rows of Conductor's session events table into
 * our session events and counts, per Conductor event type, how many it mapped and how many it could
 * not; `MAPPED_AGENTS`, the agents it maps; `conductorTranscript`, what Conductor's chat shows of a
 * chat, read from its `session_messages` rows; and `compareTranscripts`, which compares that with
 * what our chat shows, by content, and names the first difference.
 * Behaviour: docs/research/conductor/sessions.md section 5 (the durable event types `userMessage`,
 * `agent` and `checkpointCreated`; an agent event carries the agent's raw payload, for Claude the
 * SDK's stream-json message), sessions-and-chats.md ("How chats are stored": `reverted_at`), and
 * services-map.md 2.2 (`session_messages`, the projection Conductor's chat reads), and frontend.md
 * section 5 ("What one turn shows": which rows and content blocks Conductor's chat shows). Our
 * events are packages/protocol/src/events.ts. Claude's raw payloads go through `ClaudeTranslator`,
 * the one home of that translation, so a mapped chat reads as a chat our runner wrote.
 * Must handle: content that is not JSON, or JSON of another shape, counts as unmapped and never
 * throws; a queued user message is understood but shows nothing (its sent event is the one shown);
 * a reverted event is counted on its own and left out; an agent payload of an agent other than
 * Claude counts as unmapped until its translator is written; a checkpoint event counts as unmapped,
 * because it names a snapshot under Conductor's own refs, which Conducted does not restore; nothing
 * here logs, so no message text leaves this function except in the events it returns. A
 * transcript compares the user's messages and the main agent's text and tool cards, by content
 * with white space folded; a sub-agent's messages sit inside its call in Conductor, so they are not
 * part of the main transcript; thinking, tool results, errors and notices are not compared.
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
	if (!MAPPED_AGENTS.has(agent) || typeof payload !== "object" || payload === null) return null;
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

/** The agents whose payloads this mapping translates. Chats of other agents are not mapped yet. */
export const MAPPED_AGENTS: ReadonlySet<AgentKind> = new Set<AgentKind>(["claude"]);

/** One thing the agent shows in a chat's main transcript: a text block or a tool card. */
export type TranscriptEntry = { kind: "text"; text: string } | { kind: "tool"; name: string };

/** What one turn shows: the user's messages in order, then the agent's entries in order. */
export interface TranscriptTurn {
	user: string[];
	agent: TranscriptEntry[];
}

/**
 * Text as a reader sees it: runs of white space read as one space, and the ends are trimmed. Null
 * for text that shows nothing.
 */
export function shownText(value: string): string | null {
	const shown = value.replace(/\s+/g, " ").trim();
	return shown === "" ? null : shown;
}

/** One row of Conductor's `session_messages`, the projection its chat reads. */
export interface ConductorMessageRow {
	id: string;
	role: string | null;
	content: string | null;
	sent_at: string | null;
	created_at: string | null;
	turn_id: string | null;
}

interface ShownRow {
	sentAt: number;
	createdAt: number;
	/** Null when Conductor shows the row as a placeholder or shows nothing of it. */
	payload: Record<string, unknown> | null;
	/** A user row of the table: its content is the text the user sent. */
	userText: string | null;
}

/** The content blocks of an agent payload's message, or none. */
function blocks(payload: Record<string, unknown>): Record<string, unknown>[] {
	const message = payload.message;
	if (typeof message !== "object" || message === null) return [];
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content)
		? content.filter(
				(block): block is Record<string, unknown> => typeof block === "object" && block !== null,
			)
		: [];
}

/** True for a payload a sub-agent wrote: Conductor shows it inside the call that started it. */
const fromSubAgent = (payload: Record<string, unknown>): boolean =>
	typeof payload.parent_tool_use_id === "string" && payload.parent_tool_use_id !== "";

/** The text of a user payload as Conductor's user bubble shows it, or null when it shows none. */
function userPayloadText(payload: Record<string, unknown>): string | null {
	const message = payload.message;
	const content =
		typeof message === "object" && message !== null
			? (message as { content?: unknown }).content
			: undefined;
	if (typeof content === "string") return content;
	const parts = blocks(payload);
	// A message of tool results only is the result half of a tool card, not a bubble.
	if (parts.length > 0 && parts.every((block) => block.type === "tool_result")) return null;
	return parts
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("\n");
}

const isCompactCommand = (value: string): boolean => value.trim() === "/compact";

const isCompaction = (payload: Record<string, unknown>): boolean =>
	payload.type === "system" &&
	(payload.subtype === "compact_boundary" ||
		(payload.subtype === "status" && payload.status === "compacting"));

/** The one-word reply Claude writes after compacting, which Conductor hides beside a compaction. */
function isCompactedReply(payload: Record<string, unknown>): boolean {
	if (payload.type !== "assistant") return false;
	const texts = blocks(payload).filter((block) => block.type === "text");
	return (
		texts.length === 1 && typeof texts[0]?.text === "string" && texts[0].text.trim() === "Compacted"
	);
}

/**
 * What Conductor's chat shows of a chat, from its `session_messages` rows: one turn per turn id,
 * in the order their first user message was sent; in each turn the user's message and steers, and
 * the main agent's text blocks and tool cards, in the order they were sent. Tool results, results,
 * system rows and thinking are not compared. `subAgentText: "inline"` also keeps a sub-agent's
 * text in the main transcript, where our chat shows it today, so the spike can name that cause.
 */
export function conductorTranscript(
	rows: readonly ConductorMessageRow[],
	options: { subAgentText: "nested" | "inline" } = { subAgentText: "nested" },
): TranscriptTurn[] {
	const turns = new Map<string, { rows: ShownRow[]; startedAt: number | null }>();
	for (const row of rows) {
		// Conductor's chat reads only sent rows; a queued message is in its queue, not the chat.
		if (row.sent_at === null) continue;
		// A row with no turn is a placeholder in a turn of its own, keyed by the row's id.
		const key = row.turn_id ?? row.id;
		const turn = turns.get(key) ?? { rows: [], startedAt: null };
		turns.set(key, turn);
		const sentAt = timeOf(row.sent_at);
		const readable = row.turn_id !== null;
		const isUser = row.role === "user";
		if (isUser && turn.startedAt === null) turn.startedAt = sentAt;
		turn.rows.push({
			sentAt,
			createdAt: timeOf(row.created_at),
			payload: readable && row.role === "assistant" ? record(row.content) : null,
			userText: readable && isUser ? (row.content ?? "") : null,
		});
	}
	const started = [...turns.values()].filter(
		(turn): turn is { rows: ShownRow[]; startedAt: number } => turn.startedAt !== null,
	);
	started.sort((a, b) => a.startedAt - b.startedAt);
	return started.map((turn) => shownTurn(turn.rows, options.subAgentText === "inline"));
}

function shownTurn(rows: readonly ShownRow[], inlineSubAgentText: boolean): TranscriptTurn {
	const payloads = rows.flatMap((row) => (row.payload === null ? [] : [row.payload]));
	const compacted = payloads.some(isCompaction);
	const failedCalls = new Set(
		payloads.flatMap((payload) =>
			blocks(payload)
				.filter((block) => block.type === "tool_result" && block.is_error === true)
				.map((block) => block.tool_use_id),
		),
	);
	const ordered = [...rows].sort((a, b) => a.sentAt - b.sentAt || a.createdAt - b.createdAt);
	const user: string[] = [];
	const agent: TranscriptEntry[] = [];
	const say = (value: string) => {
		const shown = shownText(value);
		if (shown !== null) agent.push({ kind: "text", text: shown });
	};
	const wrote = (value: string) => {
		const shown = shownText(value);
		if (shown !== null && !isCompactCommand(shown)) user.push(shown);
	};
	for (const row of ordered) {
		if (row.userText !== null) {
			wrote(row.userText);
			continue;
		}
		const payload = row.payload;
		if (payload === null || (compacted && isCompactedReply(payload))) continue;
		const subAgent = fromSubAgent(payload);
		if (payload.type === "user") {
			const typed = subAgent ? null : userPayloadText(payload);
			if (typed !== null) wrote(typed);
			continue;
		}
		if (payload.type !== "assistant" || (subAgent && !inlineSubAgentText)) continue;
		for (const block of blocks(payload)) {
			if (block.type === "text" && typeof block.text === "string") say(block.text);
			else if (block.type === "tool_use" && typeof block.name === "string" && !subAgent) {
				if (shownCall(block.name, block.id, failedCalls))
					agent.push({ kind: "tool", name: block.name });
			}
		}
	}
	return { user, agent };
}

/** Codex's wait call shows no card, and its close call shows one only when it failed. */
function shownCall(name: string, id: unknown, failedCalls: ReadonlySet<unknown>): boolean {
	if (name === "collab__wait") return false;
	if (name === "collab__closeAgent") return failedCalls.has(id);
	return true;
}

/** How two transcripts compare: "match", or the first place they differ. */
export type TranscriptVerdict =
	| "match"
	| "nothing shown"
	| "sub-agent text"
	| "turns"
	| "user text"
	| "agent text"
	| "tool calls";

const sameTurns = (a: readonly TranscriptTurn[], b: readonly TranscriptTurn[]): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

/**
 * Compares what Conductor's chat shows of a chat (its rows) with what ours shows (`ours`), by
 * content. A mismatch names its first cause: our chat shows nothing, our chat shows a sub-agent's
 * text in the main transcript and nothing else differs, the number of turns, or the first turn
 * whose user messages, agent text or tool cards differ.
 */
export function compareTranscripts(
	rows: readonly ConductorMessageRow[],
	ours: readonly TranscriptTurn[],
): TranscriptVerdict {
	const theirs = conductorTranscript(rows);
	if (sameTurns(theirs, ours)) return "match";
	if (ours.length === 0) return "nothing shown";
	if (sameTurns(conductorTranscript(rows, { subAgentText: "inline" }), ours))
		return "sub-agent text";
	if (theirs.length !== ours.length) return "turns";
	for (const [index, turn] of theirs.entries()) {
		const our = ours[index] as TranscriptTurn;
		if (JSON.stringify(turn.user) !== JSON.stringify(our.user)) return "user text";
		const length = Math.max(turn.agent.length, our.agent.length);
		for (let at = 0; at < length; at++) {
			const a = turn.agent[at];
			const b = our.agent[at];
			if (JSON.stringify(a) === JSON.stringify(b)) continue;
			return a?.kind === "tool" || b?.kind === "tool" ? "tool calls" : "agent text";
		}
	}
	// Not reached: the transcripts differ and have as many turns, so a turn above differs.
	return "agent text";
}
