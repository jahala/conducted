/**
 * @feature APP-18 What Conductor's chat shows of a chat, for the chat history spike
 * Owns: `conductorTranscript`, what Conductor's chat shows of a chat, read from its
 * `session_messages` rows; `compareTranscripts`, which compares that with what our chat shows, by
 * content, and names the first difference; `shownText`, text as a reader sees it.
 * Behaviour: frontend.md section 5 ("What one turn shows": which rows and content blocks
 * Conductor's chat shows) and services-map.md 2.2 (`session_messages`, the table its chat reads).
 * Must handle: a transcript compares the user's messages and the main agent's text and tool
 * cards, by content with white space folded; a sub-agent's messages sit inside its call in
 * Conductor, so they are not part of the main transcript; thinking, tool results, errors and
 * notices are not compared; a row that cannot be read shows as a placeholder, which is not
 * compared either.
 * Our design choice: this is the Conductor side of the spike's comparison. It reads the rows by its
 * own code and shares none with the mapping (conductor-history.ts), so a wrong rule in the mapping
 * shows as a mismatch instead of agreeing with itself.
 * Test first: reads the visible messages of a chat from the rows Conductor reads.
 */
import type { ConductorMessageRow } from "./conductor-history.ts";

/** A row's content as a JSON object, or null when Conductor would show a placeholder for it. */
function record(content: string | null): Record<string, unknown> | null {
	if (content === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		// Not JSON: Conductor's chat shows "This message could not be displayed." (`CW` @1432258).
		return null;
	}
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** A Conductor text time, UTC when it names no zone, as milliseconds; 0 when it is no time. */
function timeOf(value: string | null): number {
	if (value === null) return 0;
	const trimmed = value.trim().replace(" ", "T");
	const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`;
	const parsed = Date.parse(zoned);
	return Number.isNaN(parsed) ? 0 : parsed;
}

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

/** Conductor's test for a Claude sign-in error's text (renderApp `JVt` @9517358). */
function readsAsSignInError(text: unknown): boolean {
	if (typeof text !== "string" || text === "") return false;
	const lower = text.toLowerCase();
	return (
		lower.includes("please run /login") ||
		lower.includes("authentication_error") ||
		(text.includes("401") && lower.includes("invalid authentication credentials"))
	);
}

/** A turn's result that shows the sign-in view (renderApp `SQi` @9517557, `CQi` @9517683). */
const isSignInResult = (payload: Record<string, unknown>): boolean =>
	payload.type === "result" &&
	payload.is_error === true &&
	payload.subtype === "success" &&
	readsAsSignInError(payload.result);

/**
 * An assistant message of text only that repeats a sign-in error. Conductor shows none of it when
 * the turn's result already shows the sign-in view (renderApp `kpa` @9558460).
 */
function isSignInEcho(payload: Record<string, unknown>): boolean {
	const content = blocks(payload);
	return (
		content.length > 0 &&
		content.every((block) => block.type === "text") &&
		readsAsSignInError(
			content.map((block) => (typeof block.text === "string" ? block.text : "")).join("\n"),
		)
	);
}

function shownTurn(rows: readonly ShownRow[], inlineSubAgentText: boolean): TranscriptTurn {
	const payloads = rows.flatMap((row) => (row.payload === null ? [] : [row.payload]));
	const compacted = payloads.some(isCompaction);
	const signInShown = payloads.some(isSignInResult);
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
		if (signInShown && isSignInEcho(payload)) continue;
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
