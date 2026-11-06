/**
 * @feature CHAT-17 Copy transcript and search chat history
 * @feature CHAT-26 Start a chat with earlier chats and plans
 * Owns: turning a chat's turns into text for the clipboard, the query that searches stored chats,
 * and reading the plans an agent proposed in a stored event.
 * Behaviour: ui-map.md 3.2 and 5.1 (copy concise transcript, chat history search), services-map.md
 * 2.3.3 (search is a LIKE over stored message text), inventory label #340-341 (plan shelf).
 * Must handle: "concise" keeps the user messages and the agent's text, and one line per tool
 * call; "full" adds thinking, tool inputs and outputs; reverted turns are left out; very large
 * tool outputs are cut at 2000 characters with a note; a search query under two characters
 * returns nothing; `%` and `_` in the query are matched literally; results carry the chat id and
 * a short excerpt, which the palette names; reverted events are not searched.
 * Our design choice: search runs a LIKE query over the text a user message holds and over the
 * text items of an agent message, read out of the stored JSON with SQLite's JSON functions. So
 * the row limit counts only real matches (a key name such as "text" matches nothing), and a quote,
 * a backslash or a line break in the query is compared with the text, not with its JSON escape.
 * There is no full-text index yet.
 * Test first: a concise transcript of one turn lists the user text, then the agent text, then one
 * line for each tool call.
 */
import { type SessionEvent, zSessionEvent } from "@conducted/protocol";
import { ok, type Result, type SessionId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import { collectResults, parseJsonColumn, selectRows } from "../db/row-codec.ts";
import type { ChatBlock, ChatTurn, PlanEntry } from "../model.ts";

/** Matches `%`, `_` and the escape character itself so the query is searched literally. */
export const escapeLike = (query: string): string => query.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export const HISTORY_SEARCH_MIN_QUERY = 2;

/**
 * `$1` is `%<escaped query>%`, `$2` the row limit. Reverted events are not searched. The LIKE
 * runs on the message text itself, never on the JSON around it, so the limit counts real hits.
 */
export const HISTORY_SEARCH_SQL = `SELECT e.session_id AS session_id, e.turn_id AS turn_id,
  e.type AS type, e.content AS content, e.received_at AS received_at
FROM session_events e
JOIN sessions s ON s.id = e.session_id
WHERE e.reverted_at IS NULL
  AND (
    (e.type = 'user_message' AND json_extract(e.content, '$.text') LIKE $1 ESCAPE '\\')
    OR (e.type = 'agent' AND EXISTS (
      SELECT 1 FROM json_each(e.content, '$.message.items') item
      WHERE json_extract(item.value, '$.kind') = 'text'
        AND json_extract(item.value, '$.text') LIKE $1 ESCAPE '\\'))
  )
ORDER BY e.received_at DESC
LIMIT $2`;

/** How much of one tool output the full transcript keeps before it adds a note. */
export const TRANSCRIPT_TOOL_OUTPUT_LIMIT = 2000;

export interface HistoryHit {
	sessionId: SessionId;
	turnId: string;
	excerpt: string;
	at: number;
}

interface HistoryRow {
	session_id: SessionId;
	turn_id: string;
	type: string;
	content: string;
	received_at: number;
}

function cutToolOutput(output: string): string {
	if (output.length <= TRANSCRIPT_TOOL_OUTPUT_LIMIT) return output;
	const kept = output.slice(0, TRANSCRIPT_TOOL_OUTPUT_LIMIT);
	return `${kept}\n[output cut after ${TRANSCRIPT_TOOL_OUTPUT_LIMIT} characters; ${output.length - TRANSCRIPT_TOOL_OUTPUT_LIMIT} characters not shown]`;
}

function toolInputText(block: Extract<ChatBlock, { kind: "tool" }>): string {
	return JSON.stringify(block.call.item.input ?? null) ?? "null";
}

function linesForBlock(block: ChatBlock, detail: "concise" | "full"): string[] {
	switch (block.kind) {
		case "text":
			return block.text.trim().length === 0 ? [] : [block.text];
		case "thinking":
			return detail === "full" && block.text.trim().length > 0 ? [`Thinking: ${block.text}`] : [];
		case "tool": {
			const lines = [`[tool] ${block.call.item.rawName}`];
			if (detail === "full") {
				lines.push(`Input: ${toolInputText(block)}`);
				if (block.call.result !== null) {
					lines.push(`Output:\n${cutToolOutput(block.call.result.output)}`);
				}
			}
			return lines;
		}
		case "todo":
			return detail === "full"
				? block.item.items.map((item) => `[todo ${item.status}] ${item.label}`)
				: [];
		case "notice":
			return detail === "full" && block.item.text.trim().length > 0 ? [block.item.text] : [];
		case "error":
			return detail === "full" ? [`[error] ${block.item.message}`] : [];
	}
}

/**
 * Turns a chat's turns into plain text for the clipboard. Concise keeps the conversation and one
 * line per tool call; full also includes thinking, tool inputs and their outputs.
 */
export function formatTranscript(turns: readonly ChatTurn[], detail: "concise" | "full"): string {
	const sections: string[] = [];
	for (const turn of turns) {
		if (turn.reverted) continue;
		const lines: string[] = [];
		if (turn.userMessage !== null) {
			lines.push(`User: ${turn.userMessage.text}`);
		}
		for (const steer of turn.steers) lines.push(`User: ${steer.text}`);
		for (const block of turn.blocks) lines.push(...linesForBlock(block, detail));
		if (lines.length > 0) sections.push(lines.join("\n\n"));
	}
	return sections.join("\n\n");
}

export interface TranscriptServiceDeps {
	/** Finds stored events whose text contains `query`, newest first. */
	search: (query: string, limit: number) => Promise<Result<HistoryHit[]>>;
}

/** Backs chat history search: refuses a query that is too short, then asks the stored search. */
export function searchHistory(
	deps: TranscriptServiceDeps,
	query: string,
	limit: number,
): Promise<Result<HistoryHit[]>> {
	const trimmed = query.trim();
	if (trimmed.length < HISTORY_SEARCH_MIN_QUERY || limit <= 0) return Promise.resolve(ok([]));
	return deps.search(trimmed, limit);
}

function excerptAround(text: string, query: string): string | null {
	const at = text.toLowerCase().indexOf(query.toLowerCase());
	if (at < 0) return null;
	const start = Math.max(0, at - 60);
	const end = Math.min(text.length, at + query.length + 60);
	const before = start > 0 ? "…" : "";
	const after = end < text.length ? "…" : "";
	return `${before}${text.slice(start, end).replace(/\s+/g, " ").trim()}${after}`;
}

function excerptOfEvent(event: SessionEvent, query: string): string | null {
	if (event.type === "user_message") return excerptAround(event.text, query);
	if (event.type !== "agent") return null;
	for (const item of event.message.items) {
		if (item.kind !== "text") continue;
		const excerpt = excerptAround(item.text, query);
		if (excerpt !== null) return excerpt;
	}
	return null;
}

/** Builds the stored-history search the sessions service calls. */
export function createHistorySearch(
	db: Database,
): (query: string, limit: number) => Promise<Result<HistoryHit[]>> {
	return async (query, limit) => {
		const pattern = `%${escapeLike(query)}%`;
		const rows = await selectRows<HistoryRow>(
			db,
			HISTORY_SEARCH_SQL,
			[pattern, limit],
			"Searching chat history",
		);
		if (!rows.ok) return rows;

		const events = collectResults(
			rows.value.map((row) =>
				parseJsonColumn(row.content, zSessionEvent, "session_events.content"),
			),
		);
		if (!events.ok) return events;

		const hits: HistoryHit[] = [];
		for (const [index, event] of events.value.entries()) {
			const row = rows.value[index];
			if (row === undefined) continue;
			const excerpt = excerptOfEvent(event, query);
			if (excerpt === null) continue;
			hits.push({
				sessionId: row.session_id,
				turnId: row.turn_id,
				excerpt,
				at: row.received_at,
			});
		}
		return ok(hits);
	};
}


/** The first heading or non-empty line of a plan, without its heading marks. */
export function planTitleOf(text: string): string {
	const first = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	if (first === undefined) return "Plan";
	return first.replace(/^#{1,6}\s*/, "").trim() || "Plan";
}

/** The plan text of one `exit_plan_mode` call, or null when the input holds no text. */
export function planTextOf(input: unknown): string | null {
	if (typeof input !== "object" || input === null) return null;
	const plan = (input as { plan?: unknown }).plan;
	return typeof plan === "string" ? plan : null;
}

/** The first plan text in a stored agent event for a turn, or null. */
export function planTextInEvent(event: SessionEvent, turnId: string): string | null {
	if (event.type !== "agent" || event.turnId !== turnId) return null;
	for (const item of event.message.items) {
		if (item.kind !== "tool_call" || item.tool !== "exit_plan_mode") continue;
		const text = planTextOf(item.input);
		if (text !== null) return text;
	}
	return null;
}

/** The plans a stored agent event proposed, oldest call first. Reverted events are left out. */
export function plansInEvent(
	event: SessionEvent,
	sessionId: SessionId,
	sessionTitle: string | null,
	at: number,
	reverted: boolean,
): PlanEntry[] {
	if (reverted || event.type !== "agent") return [];
	const plans: PlanEntry[] = [];
	for (const item of event.message.items) {
		if (item.kind !== "tool_call" || item.tool !== "exit_plan_mode") continue;
		const text = planTextOf(item.input);
		if (text === null) continue;
		plans.push({
			sessionId,
			sessionTitle,
			turnId: event.turnId,
			title: planTitleOf(text),
			at,
		});
	}
	return plans;
}
