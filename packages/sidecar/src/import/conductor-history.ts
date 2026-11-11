/**
 * @feature APP-18 Conductor's chat history as our session events, for the chat history spike
 * Owns: `mapConductorMessages`, which turns one chat's rows of Conductor's `session_messages`
 * table into our session events, and counts per row kind how many it mapped and how many it could
 * not, why it could not, and which mapped rows it left out because Conductor does not show them;
 * `MAPPED_AGENTS`, the agents it maps; `ConductorMessageRow`, the columns it reads.
 * Behaviour: services-map.md 2.2 and 2.4.3 (`session_messages` is the table Conductor's chat
 * reads; a sent row has a turn id) and frontend.md section 5 ("What one turn shows"). The rules,
 * each from Conductor's web bundle (main-BE1h_1MP.js, offsets in its own comment):
 *  - What a row is: a `user` row's content is the text the user sent; an `assistant` row's content
 *    is one agent payload as JSON, for Claude one SDK message; a `SUMMARY` row is a compaction
 *    summary; any other role cannot be read (`CW` @1432258, `Emt` @1429456). The writer stores
 *    one row per payload it keeps (`Ppe` @1574435), so the SDK's one-block-per-message stream is
 *    one row per content block; it skips a repeat of a payload by its uuid (`Fmt` @1442990); it
 *    never stores stream deltas, which its schema does not accept (`SW` @1413697), nor a user
 *    payload without a tool result (`kpe` @1570433), which is why an injected `isSynthetic` note
 *    is never in this table; it stores a local command's output as assistant text (`NW` @1574397).
 *  - Which rows a turn holds: rows group by turn id; a group without a user row is not shown
 *    (`MW` @1528687, `wp` @1423850); turns are ordered by when their first user row was sent;
 *    in a turn, rows are in sent order, ties by creation time (`kW` @1419414); the first user row
 *    is the turn's message and later ones are steers (`wp`).
 *  - What a turn hides that our chat would show: a user message or payload whose text is
 *    `/compact` (`Zft` @1421093), and the one-word "Compacted" reply in a turn that compacted
 *    (`cmt` @1424913, `omt` @1424403). Both are left out and counted.
 *  - A main-agent user payload with text shows as a user bubble (`AW` @1421589), so it maps to a
 *    steer, the user message our chat shows inside a running turn.
 * Our events are packages/protocol/src/events.ts. Claude's payloads go through `ClaudeTranslator`,
 * the one home of that translation, so a mapped chat reads as a chat our runner wrote, and a
 * sub-agent's messages nest the way the translator marks them.
 * Must handle: a row that cannot be read (no turn id, content that is not a JSON payload, a
 * summary, an unknown role, a payload the translator fails on) is counted unmapped by reason and
 * never throws; a queued row (no sent time) is not in Conductor's chat, so it is left out; an
 * agent row of an agent other than Claude is unmapped until its translator is written; nothing
 * here logs, so no message text leaves this function except in the events it returns.
 * Our design choice: the mapping lives in the sidecar beside the runners' translators. The import
 * can only bring history once the spike's pass mark is met (D100); this function is what the spike
 * measures (scripts/conductor-import/spike.ts) and what that import will run (D124). The spike's
 * Conductor side (conductor-transcript.ts) reads the same rows by its own code, so that the
 * comparison tests this mapping instead of agreeing with it.
 * Test first: maps each turn to its user message, steers and agent events, in the order Conductor
 * shows them.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage, SessionConfig, SessionEvent } from "@conducted/protocol";
import {
	type AgentKind,
	type EventId,
	err,
	type MessageId,
	ok,
	type Result,
	type TurnId,
} from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { ClaudeTranslator } from "../runners/claude/translate.ts";

/** One row of Conductor's `session_messages`: the columns its chat reads to show a message. */
export interface ConductorMessageRow {
	id: string;
	role: string | null;
	content: string | null;
	sent_at: string | null;
	created_at: string | null;
	turn_id: string | null;
}

/** The agents whose payloads this mapping translates. Chats of other agents are not mapped yet. */
export const MAPPED_AGENTS: ReadonlySet<AgentKind> = new Set<AgentKind>(["claude"]);

/** A row's kind, by its role. Any role Conductor does not know counts as "other". */
export const ROW_KINDS = ["user", "agent", "summary", "other"] as const;
export type RowKind = (typeof ROW_KINDS)[number];

/** Why a row could not be mapped. */
export const UNMAPPED_REASONS = [
	"no turn",
	"unreadable",
	"summary",
	"unknown role",
	"untranslated",
] as const;
export type UnmappedReason = (typeof UNMAPPED_REASONS)[number];

/** Why a mapped row adds nothing: Conductor does not show it either. */
export const LEFT_OUT_REASONS = [
	"queued message",
	"turn without a user message",
	"compact command",
	"compacted reply",
] as const;
export type LeftOutReason = (typeof LEFT_OUT_REASONS)[number];

export interface RowCount {
	rows: number;
	mapped: number;
	unmapped: number;
}

export interface MappedHistory {
	events: SessionEvent[];
	counts: Record<RowKind, RowCount>;
	unmapped: Record<UnmappedReason, number>;
	/** Mapped rows that add no event, because Conductor's chat does not show them. */
	leftOut: Record<LeftOutReason, number>;
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

type Payload = Record<string, unknown>;

/** A row that can be read, with the turn it belongs to. */
interface ReadRow {
	id: string;
	kind: "user" | "agent";
	turnId: string;
	sentAt: number;
	createdAt: number;
	/** The user's text for a user row, the agent payload for an agent row. */
	text: string;
	payload: Payload | null;
}

const zeroed = <K extends string>(keys: readonly K[]): Record<K, number> =>
	Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

const kindOf = (role: string | null): RowKind =>
	role === "user"
		? "user"
		: role === "assistant"
			? "agent"
			: role === "SUMMARY"
				? "summary"
				: "other";

/** A Conductor text time, UTC when it names no zone, as milliseconds; 0 when it is no time. */
function millis(value: string | null): number {
	if (value === null) return 0;
	const trimmed = value.trim().replace(" ", "T");
	const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`;
	const parsed = Date.parse(zoned);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/** An agent row's payload: a JSON object with a string type, or the reason it is not one. */
function payloadOf(content: string | null): Result<Payload, "unreadable"> {
	if (content === null) return err("unreadable");
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		return err("unreadable");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return err("unreadable");
	const payload = value as Payload;
	return typeof payload.type === "string" ? ok(payload) : err("unreadable");
}

/** Reads one sent row, or names why it cannot be mapped. */
function readRow(row: ConductorMessageRow, kind: RowKind): Result<ReadRow, UnmappedReason> {
	if (kind === "other") return err("unknown role");
	if (kind === "summary") return err("summary");
	if (row.turn_id === null) return err("no turn");
	const base = {
		id: row.id,
		turnId: row.turn_id,
		sentAt: millis(row.sent_at),
		createdAt: millis(row.created_at),
	};
	if (kind === "user") return ok({ ...base, kind, text: row.content ?? "", payload: null });
	const payload = payloadOf(row.content);
	return payload.ok ? ok({ ...base, kind, text: "", payload: payload.value }) : err(payload.error);
}

/** A payload a sub-agent wrote: Conductor shows it inside the call that started it. */
const bySubAgent = (payload: Payload): boolean =>
	typeof payload.parent_tool_use_id === "string" && payload.parent_tool_use_id !== "";

/** The content blocks of a payload's message, or none when its content is not a list. */
function contentBlocks(payload: Payload): Payload[] {
	const message = payload.message;
	if (typeof message !== "object" || message === null) return [];
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content)
		? content.filter((block): block is Payload => typeof block === "object" && block !== null)
		: [];
}

/** The text a user payload's bubble shows, or null when it shows no bubble (`AW`, `Zft`). */
function bubbleText(payload: Payload): string | null {
	const message = payload.message;
	const content =
		typeof message === "object" && message !== null
			? (message as { content?: unknown }).content
			: undefined;
	if (typeof content === "string") return content;
	const blocks = contentBlocks(payload);
	if (blocks.length > 0 && blocks.every((block) => block.type === "tool_result")) return null;
	return blocks
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("\n");
}

const isCompactCommand = (text: string): boolean => text.trim() === "/compact";

/** A system payload that marks a compaction (`amt`, `$V` @1424403). */
const marksCompaction = (payload: Payload): boolean =>
	payload.type === "system" &&
	(payload.subtype === "compact_boundary" ||
		(payload.subtype === "status" && payload.status === "compacting"));

/** An assistant payload whose only text block reads "Compacted" (`omt` @1424403). */
function isCompactedReply(payload: Payload): boolean {
	if (payload.type !== "assistant") return false;
	const texts = contentBlocks(payload).filter((block) => block.type === "text");
	const only = texts[0];
	return texts.length === 1 && typeof only?.text === "string" && only.text.trim() === "Compacted";
}

/** In Conductor's order within a turn: sent time, then creation time, then the table's order. */
const inTurnOrder = (a: ReadRow, b: ReadRow): number =>
	a.sentAt - b.sentAt || a.createdAt - b.createdAt;

/**
 * Maps one chat's rows, given in the order Conductor's chat reads them (sent time, then rowid).
 * `config` is the chat's config, which our user_message events carry; `agent` picks the
 * translator for its agent rows.
 */
export function mapConductorMessages(
	rows: readonly ConductorMessageRow[],
	chat: { agent: AgentKind; config: SessionConfig },
): MappedHistory {
	const counts = Object.fromEntries(
		ROW_KINDS.map((kind) => [kind, { rows: 0, mapped: 0, unmapped: 0 }]),
	) as Record<RowKind, RowCount>;
	const unmapped = zeroed(UNMAPPED_REASONS);
	const leftOut = zeroed(LEFT_OUT_REASONS);
	const fail = (kind: RowKind, reason: UnmappedReason) => {
		counts[kind].unmapped++;
		unmapped[reason]++;
	};
	const skip = (kind: RowKind, reason: LeftOutReason) => {
		counts[kind].mapped++;
		leftOut[reason]++;
	};

	// Group the readable rows by turn, keeping the first user row of each turn as it was read.
	const turns = new Map<string, { rows: ReadRow[]; startedAt: number | null }>();
	for (const row of rows) {
		const kind = kindOf(row.role);
		counts[kind].rows++;
		if (row.sent_at === null) {
			skip(kind, "queued message");
			continue;
		}
		const read = readRow(row, kind);
		if (!read.ok) {
			fail(kind, read.error);
			continue;
		}
		const turn = turns.get(read.value.turnId) ?? { rows: [], startedAt: null };
		turns.set(read.value.turnId, turn);
		turn.rows.push(read.value);
		if (read.value.kind === "user" && turn.startedAt === null) turn.startedAt = read.value.sentAt;
	}

	const translator = new ClaudeTranslator({ logger: SILENT });
	const translates = MAPPED_AGENTS.has(chat.agent);
	const events: SessionEvent[] = [];
	const shown: { rows: ReadRow[]; startedAt: number }[] = [];
	for (const turn of turns.values()) {
		if (turn.startedAt === null) {
			for (const row of turn.rows) skip(row.kind, "turn without a user message");
		} else {
			shown.push({ rows: turn.rows, startedAt: turn.startedAt });
		}
	}
	shown.sort((a, b) => a.startedAt - b.startedAt);

	for (const turn of shown) {
		const ordered = [...turn.rows].sort(inTurnOrder);
		const compacted = ordered.some(
			(row) => row.payload !== null && !bySubAgent(row.payload) && marksCompaction(row.payload),
		);
		let firstUserRow = true;
		for (const row of ordered) {
			const turnId = row.turnId as TurnId;
			const at = row.sentAt;
			const userMessage = (text: string, delivery: "new_turn" | "steer"): SessionEvent => ({
				eventId: row.id as EventId,
				at,
				type: "user_message",
				messageId: row.id as MessageId,
				turnId,
				text,
				attachmentPaths: [],
				delivery,
				config: chat.config,
			});
			if (row.payload === null) {
				const delivery = firstUserRow ? "new_turn" : "steer";
				firstUserRow = false;
				if (isCompactCommand(row.text)) skip("user", "compact command");
				else {
					counts.user.mapped++;
					events.push(userMessage(row.text, delivery));
				}
				continue;
			}
			const payload = row.payload;
			const topLevel = !bySubAgent(payload);
			if (topLevel && compacted && isCompactedReply(payload)) {
				skip("agent", "compacted reply");
				continue;
			}
			const typed = topLevel && payload.type === "user" ? bubbleText(payload) : null;
			if (typed !== null && isCompactCommand(typed)) {
				skip("agent", "compact command");
				continue;
			}
			if (!translates) {
				fail("agent", "untranslated");
				continue;
			}
			let messages: AgentMessage[];
			try {
				messages = translator.translate(payload as unknown as SDKMessage);
			} catch {
				// A payload of a shape the SDK's types do not allow; Conductor shows a placeholder.
				fail("agent", "untranslated");
				continue;
			}
			counts.agent.mapped++;
			const made: SessionEvent[] = [];
			if (typed !== null && typed.trim() !== "") made.push(userMessage(typed, "steer"));
			for (const message of messages) {
				made.push({ eventId: row.id as EventId, at, type: "agent", turnId, message });
			}
			made.forEach((event, part) => {
				events.push(part === 0 ? event : { ...event, eventId: `${row.id}:${part}` as EventId });
			});
		}
	}
	return { events, counts, unmapped, leftOut };
}
