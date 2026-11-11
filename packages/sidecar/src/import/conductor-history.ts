/**
 * @feature APP-18 Conductor's chat history as our session events
 * Owns: `ConductorHistoryMapper`, which maps one chat's rows of Conductor's `session_messages`
 * table into our session events in two reads, so a chat of any size is held one read at a time:
 * first every row's columns without its content (`addKeys`), then the rows themselves in the
 * order Conductor shows them, a budget at a time (`nextRead`, `map`); `mapConductorMessages`,
 * the same mapping over rows already in memory, which the spike measures
 * (scripts/conductor-import/spike.ts); the counts per row kind of what it mapped, could not map
 * and why, and which mapped rows it left out because Conductor does not show them;
 * `MAPPED_AGENTS`, the agents it maps; `ConductorMessageRow`, the columns it reads. The two reads'
 * row shapes are the protocol's (`ConductorMessageKey`, `ConductorPlacedRow`).
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
 * here logs, so no message text leaves this function except in the events it returns. The order
 * depends only on each row's times and its place in the table (`rowid`, the table's order, which
 * breaks a tie as Conductor's `ORDER BY sent_at, rowid` does), never on the order rows arrive in,
 * so the second read may fetch them in any order; a read cuts a turn when the turn is larger than
 * the budget, and the mapper carries the turn over: a "Compacted" reply whose turn has not yet
 * shown a compaction is held, with the rows after it, until the turn shows one or ends; a row the
 * second read did not return is an error, and the chat maps to nothing.
 * Our design choice: each shown turn that produced an event ends with a `turn_ended` event, as
 * our runner ends one (turn-tracker.ts): its last top-level result that is not a background
 * task's (`num_turns` 0) decides success or error, by the translator's `resultErrorItem`, so the
 * error reads as the result's error item already shows it. A turn with no such result ends
 * `interrupted`: nothing in Conductor's rows says it finished. Without an end, our chat would show
 * every imported turn as stopped and startup repair would add an end to each.
 * Our design choice: the mapping lives in the sidecar beside the runners' translators, and the
 * import drives it over RPC (history-imports.ts). The spike's Conductor side (conductor-
 * transcript.ts) reads the same rows by its own code, so the comparison tests this mapping
 * instead of agreeing with it.
 * Test first: maps each turn to its user message, steers and agent events, in the order Conductor
 * shows them.
 */
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import {
	type AgentMessage,
	CONDUCTOR_MAPPED_AGENTS,
	type ConductorMessageKey,
	type ConductorPlacedRow,
	type SessionConfig,
	type SessionEvent,
} from "@conducted/protocol";
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
import { ClaudeTranslator, resultErrorItem } from "../runners/claude/translate.ts";

/** One row of Conductor's `session_messages`: the columns its chat reads to show a message. */
export interface ConductorMessageRow {
	id: string;
	role: string | null;
	content: string | null;
	sent_at: string | null;
	created_at: string | null;
	turn_id: string | null;
}

/** The most rows and content characters one read of the second pass may ask for. */
export interface ReadBudget {
	rows: number;
	chars: number;
}

/** The agents whose payloads this mapping translates. Chats of other agents are not mapped yet. */
export const MAPPED_AGENTS: ReadonlySet<AgentKind> = new Set<AgentKind>(CONDUCTOR_MAPPED_AGENTS);

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

export interface HistoryCounts {
	counts: Record<RowKind, RowCount>;
	unmapped: Record<UnmappedReason, number>;
	/** Mapped rows that add no event, because Conductor's chat does not show them. */
	leftOut: Record<LeftOutReason, number>;
}

export interface MappedHistory extends HistoryCounts {
	events: SessionEvent[];
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

/** Reads one sent row of a user or agent kind with a turn, or names why it cannot be mapped. */
function readRow(
	row: ConductorMessageRow,
	kind: "user" | "agent",
): Result<ReadRow, UnmappedReason> {
	const base = { id: row.id, turnId: row.turn_id ?? "", sentAt: millis(row.sent_at) };
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

/** A result that ends a turn: top-level, and not a background task's mini result (num_turns 0). */
const endsTurn = (payload: Payload): boolean =>
	payload.type === "result" && !bySubAgent(payload) && payload.num_turns !== 0;

/** Where a row sits: its sent time, then its place in the table. */
interface Place {
	at: number;
	rowid: number;
}
const earlier = (a: Place, b: Place): boolean =>
	a.at < b.at || (a.at === b.at && a.rowid < b.rowid);

/** What the first read learned of one turn: where it starts, and whether Conductor shows it. */
interface TurnIndex {
	turnId: string;
	firstUser: Place | null;
	firstSeen: Place;
}

/**
 * Each row the first read gave, one column per field and one entry per row, for the whole chat.
 * Plain number lists, so a row costs a few numbers whatever its content holds.
 */
interface RowColumns {
	rowid: number[];
	sentAt: number[];
	createdAt: number[];
	chars: number[];
	/** The row's turn, as its place in the list of turns. */
	turn: number[];
}

/** A row the current read asked for. */
interface Wanted {
	rowid: number;
	turn: number;
	last: boolean;
}

/** The state of the turn being mapped, carried from one read to the next. */
interface OpenTurn {
	turn: number;
	turnId: string;
	shown: boolean;
	compacted: boolean;
	firstUserRow: boolean;
	/** Rows held since a "Compacted" reply, until the turn shows a compaction or ends. */
	held: ReadRow[] | null;
	lastResult: Payload | null;
	lastAt: number;
	emitted: boolean;
}

const UNBOUNDED: ReadBudget = { rows: Number.POSITIVE_INFINITY, chars: Number.POSITIVE_INFINITY };

/**
 * Maps one chat. Call `addKeys` with every row's columns, then repeat `nextRead` and `map` with
 * the rows it names until `nextRead` answers null; `summary` gives the counts.
 */
export class ConductorHistoryMapper {
	readonly #config: SessionConfig;
	readonly #translates: boolean;
	readonly #translator = new ClaudeTranslator({ logger: SILENT });
	readonly #counts = Object.fromEntries(
		ROW_KINDS.map((kind) => [kind, { rows: 0, mapped: 0, unmapped: 0 }]),
	) as Record<RowKind, RowCount>;
	readonly #unmapped = zeroed(UNMAPPED_REASONS);
	readonly #leftOut = zeroed(LEFT_OUT_REASONS);
	readonly #turnIds = new Map<string, number>();
	readonly #turns: TurnIndex[] = [];
	#rows: RowColumns = { rowid: [], sentAt: [], createdAt: [], chars: [], turn: [] };
	/** Row places in the order the chat shows them, once planned; and whether each turn shows. */
	#plan: { order: number[]; shown: boolean[] } | null = null;
	#cursor = 0;
	#wanted: Wanted[] | null = null;
	#open: OpenTurn | null = null;
	#events: SessionEvent[] = [];

	constructor(chat: { agent: AgentKind; config: SessionConfig }) {
		this.#config = chat.config;
		this.#translates = MAPPED_AGENTS.has(chat.agent);
	}

	/** Takes the columns of more rows, in any order. Refused once the second read has begun. */
	addKeys(keys: readonly ConductorMessageKey[]): Result<void, string> {
		if (this.#plan !== null) return err("The rows were already planned.");
		for (const key of keys) {
			const kind = kindOf(key.role);
			this.#counts[kind].rows++;
			if (key.sent_at === null) {
				this.#skip(kind, "queued message");
				continue;
			}
			if (kind === "other") this.#fail(kind, "unknown role");
			else if (kind === "summary") this.#fail(kind, "summary");
			else if (key.turn_id === null) this.#fail(kind, "no turn");
			else this.#index(key, kind);
		}
		return ok(undefined);
	}

	/**
	 * The rowids of the next rows to read, in the order they show, at most `budget` of them (and at
	 * least one); null once every row has been read and mapped.
	 */
	nextRead(budget: ReadBudget): Result<number[] | null, string> {
		if (this.#wanted !== null) return err("The last read has not been mapped yet.");
		const { order } = this.#planned();
		const rows = this.#rows;
		const wanted: Wanted[] = [];
		let chars = 0;
		while (this.#cursor < order.length && wanted.length < budget.rows) {
			const place = order[this.#cursor] ?? 0;
			const size = rows.chars[place] ?? 0;
			if (wanted.length > 0 && chars + size > budget.chars) break;
			chars += size;
			const turn = rows.turn[place] ?? 0;
			this.#cursor++;
			const next = order[this.#cursor];
			const last = next === undefined || rows.turn[next] !== turn;
			wanted.push({ rowid: rows.rowid[place] ?? -1, turn, last });
		}
		if (wanted.length === 0) return ok(null);
		this.#wanted = wanted;
		return ok(wanted.map((entry) => entry.rowid));
	}

	/** Maps the rows the last `nextRead` named, given in any order, and returns their events. */
	map(rows: readonly ConductorPlacedRow[]): Result<SessionEvent[], string> {
		const wanted = this.#wanted;
		if (wanted === null) return err("No read was asked for.");
		const { shown } = this.#planned();
		const byRowid = new Map(rows.map((row) => [row.rowid, row]));
		this.#events = [];
		for (const entry of wanted) {
			const row = byRowid.get(entry.rowid);
			const turn = this.#turns[entry.turn];
			if (row === undefined || turn === undefined) {
				return err("A row of the chat was not in the read; the copy changed while it was read.");
			}
			if (this.#open?.turn !== entry.turn) {
				this.#open = this.#openTurn(entry.turn, turn.turnId, shown[entry.turn] ?? false);
			}
			this.#take(row, this.#open);
			if (entry.last) this.#endTurn(this.#open);
		}
		this.#wanted = null;
		const events = this.#events;
		this.#events = [];
		return ok(events);
	}

	summary(): HistoryCounts {
		return { counts: this.#counts, unmapped: this.#unmapped, leftOut: this.#leftOut };
	}

	#fail(kind: RowKind, reason: UnmappedReason): void {
		this.#counts[kind].unmapped++;
		this.#unmapped[reason]++;
	}

	#skip(kind: RowKind, reason: LeftOutReason): void {
		this.#counts[kind].mapped++;
		this.#leftOut[reason]++;
	}

	#index(key: ConductorMessageKey, kind: "user" | "agent"): void {
		const turnId = key.turn_id ?? "";
		const place = { at: millis(key.sent_at), rowid: key.rowid };
		let index = this.#turnIds.get(turnId);
		if (index === undefined) {
			index = this.#turns.length;
			this.#turnIds.set(turnId, index);
			this.#turns.push({ turnId, firstUser: null, firstSeen: place });
		}
		const turn = this.#turns[index];
		if (turn === undefined) return;
		if (earlier(place, turn.firstSeen)) turn.firstSeen = place;
		if (kind === "user" && (turn.firstUser === null || earlier(place, turn.firstUser))) {
			turn.firstUser = place;
		}
		const rows = this.#rows;
		rows.rowid.push(key.rowid);
		rows.sentAt.push(place.at);
		rows.createdAt.push(millis(key.created_at));
		rows.chars.push(key.chars);
		rows.turn.push(index);
	}

	/**
	 * Shown turns by their first user row's sent time, then the turns Conductor does not show,
	 * whose rows are still read so they are counted. In a turn: sent time, creation time, rowid.
	 * The times are dropped once the order is set.
	 */
	#planned(): { order: number[]; shown: boolean[] } {
		if (this.#plan !== null) return this.#plan;
		const turns = this.#turns;
		const bySeen = (a: number, b: number): number => {
			const left = turns[a]?.firstSeen ?? { at: 0, rowid: 0 };
			const right = turns[b]?.firstSeen ?? { at: 0, rowid: 0 };
			return left.at - right.at || left.rowid - right.rowid;
		};
		const indexes = turns.map((_, index) => index);
		const shownTurns = indexes
			.filter((index) => turns[index]?.firstUser != null)
			.sort(
				(a, b) => (turns[a]?.firstUser?.at ?? 0) - (turns[b]?.firstUser?.at ?? 0) || bySeen(a, b),
			);
		const hiddenTurns = indexes.filter((index) => turns[index]?.firstUser == null).sort(bySeen);
		const rank: number[] = [];
		[...shownTurns, ...hiddenTurns].forEach((index, position) => {
			rank[index] = position;
		});
		const rows = this.#rows;
		const order = rows.rowid
			.map((_, place) => place)
			.sort(
				(a, b) =>
					(rank[rows.turn[a] ?? 0] ?? 0) - (rank[rows.turn[b] ?? 0] ?? 0) ||
					(rows.sentAt[a] ?? 0) - (rows.sentAt[b] ?? 0) ||
					(rows.createdAt[a] ?? 0) - (rows.createdAt[b] ?? 0) ||
					(rows.rowid[a] ?? 0) - (rows.rowid[b] ?? 0),
			);
		this.#rows = { ...rows, sentAt: [], createdAt: [] };
		this.#turnIds.clear();
		this.#plan = { order, shown: turns.map((turn) => turn.firstUser !== null) };
		return this.#plan;
	}

	#openTurn(turn: number, turnId: string, shown: boolean): OpenTurn {
		return {
			turn,
			turnId,
			shown,
			compacted: false,
			firstUserRow: true,
			held: null,
			lastResult: null,
			lastAt: 0,
			emitted: false,
		};
	}

	#take(row: ConductorPlacedRow, open: OpenTurn): void {
		const kind = row.role === "user" ? "user" : "agent";
		const read = readRow(row, kind);
		if (!read.ok) {
			this.#fail(kind, read.error);
			return;
		}
		if (!open.shown) {
			this.#skip(kind, "turn without a user message");
			return;
		}
		open.lastAt = Math.max(open.lastAt, read.value.sentAt);
		const payload = read.value.payload;
		const topLevel = payload !== null && !bySubAgent(payload);
		if (topLevel && marksCompaction(payload)) open.compacted = true;
		if (open.held !== null) {
			open.held.push(read.value);
			if (open.compacted) this.#release(open);
			return;
		}
		if (topLevel && !open.compacted && isCompactedReply(payload)) {
			open.held = [read.value];
			return;
		}
		this.#emit(read.value, open);
	}

	/** Maps the rows held since a "Compacted" reply, now that the turn decided what it hides. */
	#release(open: OpenTurn): void {
		const held = open.held ?? [];
		open.held = null;
		for (const row of held) this.#emit(row, open);
	}

	#endTurn(open: OpenTurn): void {
		this.#release(open);
		if (!open.emitted) return;
		const turnId = open.turnId as TurnId;
		const base = { eventId: `${open.turnId}:end` as EventId, at: open.lastAt, turnId };
		const error =
			this.#translates && open.lastResult !== null
				? resultErrorItem(open.lastResult as unknown as SDKResultMessage)
				: null;
		const outcome =
			!this.#translates || open.lastResult === null
				? "interrupted"
				: error === null
					? "success"
					: "error";
		this.#events.push(
			outcome === "error" && error !== null
				? { ...base, type: "turn_ended", outcome, error: error.message }
				: { ...base, type: "turn_ended", outcome },
		);
	}

	/** The one-row step of the mapping: the row's events, in order, or why it adds none. */
	#emit(row: ReadRow, open: OpenTurn): void {
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
			config: this.#config,
		});
		const push = (made: SessionEvent[]): void => {
			made.forEach((event, part) => {
				this.#events.push(
					part === 0 ? event : { ...event, eventId: `${row.id}:${part}` as EventId },
				);
			});
			if (made.length > 0) open.emitted = true;
		};
		if (row.payload === null) {
			const delivery = open.firstUserRow ? "new_turn" : "steer";
			open.firstUserRow = false;
			if (isCompactCommand(row.text)) this.#skip("user", "compact command");
			else {
				this.#counts.user.mapped++;
				push([userMessage(row.text, delivery)]);
			}
			return;
		}
		const payload = row.payload;
		const topLevel = !bySubAgent(payload);
		if (topLevel && open.compacted && isCompactedReply(payload)) {
			this.#skip("agent", "compacted reply");
			return;
		}
		const typed = topLevel && payload.type === "user" ? bubbleText(payload) : null;
		if (typed !== null && isCompactCommand(typed)) {
			this.#skip("agent", "compact command");
			return;
		}
		if (!this.#translates) {
			this.#fail("agent", "untranslated");
			return;
		}
		let messages: AgentMessage[];
		try {
			messages = this.#translator.translate(payload as unknown as SDKMessage);
		} catch {
			// A payload of a shape the SDK's types do not allow; Conductor shows a placeholder.
			this.#fail("agent", "untranslated");
			return;
		}
		this.#counts.agent.mapped++;
		if (endsTurn(payload)) open.lastResult = payload;
		const made: SessionEvent[] = [];
		if (typed !== null && typed.trim() !== "") made.push(userMessage(typed, "steer"));
		for (const message of messages) {
			made.push({ eventId: row.id as EventId, at, type: "agent", turnId, message });
		}
		push(made);
	}
}

/**
 * Maps one chat's rows already in memory. A row's place in the list stands for its place in the
 * table, so give them in the order Conductor's chat reads them (sent time, then rowid). `config` is
 * the chat's config, which our user_message events carry; `agent` picks the translator.
 */
export function mapConductorMessages(
	rows: readonly ConductorMessageRow[],
	chat: { agent: AgentKind; config: SessionConfig },
): MappedHistory {
	const mapper = new ConductorHistoryMapper(chat);
	const placed = rows.map((row, rowid) => ({ ...row, rowid }));
	mapper.addKeys(
		placed.map((row) => ({
			rowid: row.rowid,
			role: row.role,
			turn_id: row.turn_id,
			sent_at: row.sent_at,
			created_at: row.created_at,
			chars: row.content?.length ?? 0,
		})),
	);
	const events: SessionEvent[] = [];
	const read = mapper.nextRead(UNBOUNDED);
	if (read.ok && read.value !== null) {
		const mapped = mapper.map(placed);
		if (mapped.ok) events.push(...mapped.value);
	}
	return { events, ...mapper.summary() };
}
