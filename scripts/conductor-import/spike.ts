/**
 * @feature APP-18 The chat history spike: does Conductor's history map whole?
 * Owns: `bun scripts/conductor-import/spike.ts <path-to-a-conductor-db-copy> [--sample N]`. It
 * clones the copy into a folder of its own, opens the clone read-only, reads every chat that has
 * `session_messages` rows (or N of them, spread evenly), maps each chat's rows with the mapping the
 * import will use (packages/sidecar/src/import/conductor-history.ts), and prints counts only: chats
 * per agent, rows per kind, mapped and unmapped per kind, why rows were not mapped, which mapped
 * rows were left out because Conductor does not show them, the mapped share, and for each chat
 * whether its transcript in our chat (the turns our turn builder makes of the mapped events) reads
 * the same as in Conductor's (conductor-transcript.ts, from the same rows), as match, mismatch
 * with its first cause, or not mapped yet. It also counts chats that have events but no messages,
 * the only history that reading messages could miss.
 * Behaviour: docs/plans/migrate-from-conductor.md, "The spike first": the pass mark is at least
 * 99% of the rows in the sampled chats the mapping handles mapped, and every such chat reading
 * the same as in Conductor. A chat of an agent the mapping does not handle yet (Codex today) is
 * counted apart and left out of the mark. Below the mark, chat history does not come over.
 * Must handle: it never prints, logs or returns a value from the database (no text, path, title,
 * name, id, role or agent it does not know: an unknown one counts as "other"); an error prints
 * its kind only, never its message, which could quote a row; the copy and the folder beside it
 * stay as they were, because SQLite opens only the clone (opening a database creates files beside
 * it); the clone's folder is removed when the run ends, even when it fails. A sample is spread
 * evenly over the chats that have messages, in id order, so a second run reads the same chats.
 * Test first: prints counts only, never a value from the database.
 */
import { Database } from "bun:sqlite";
import { constants, copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatTurn } from "../../apps/desktop/src/core/model.ts";
import { buildTurns } from "../../apps/desktop/src/core/services/turn-builder.ts";
import { idleLiveState } from "../../packages/protocol/src/live-state.ts";
import type { SessionConfig } from "../../packages/protocol/src/session-config.ts";
import type { AgentKind } from "../../packages/shared/src/ids.ts";
import {
	type ConductorMessageRow,
	LEFT_OUT_REASONS,
	MAPPED_AGENTS,
	mapConductorMessages,
	ROW_KINDS,
	type RowCount,
	UNMAPPED_REASONS,
} from "../../packages/sidecar/src/import/conductor-history.ts";
import {
	compareTranscripts,
	conductorTranscript,
	shownText,
	type TranscriptEntry,
	type TranscriptTurn,
	type TranscriptVerdict,
} from "../../packages/sidecar/src/import/conductor-transcript.ts";

const PASS_SHARE = 0.99;

/** The config our user_message events carry. The spike stores nothing, so any valid one does. */
const SPIKE_CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

/** The agents a chat is reported under: the four Conductor knows, and "other" for anything else. */
const AGENT_LABELS = ["claude", "codex", "cursor", "acp", "other"] as const;
type AgentLabel = (typeof AGENT_LABELS)[number];

/** Conductor's agent type; a chat with none is a Claude chat, from before Conductor had others. */
const agentOf = (type: string | null): AgentLabel =>
	type === null || type === "claude"
		? "claude"
		: type === "codex" || type === "cursor" || type === "acp"
			? type
			: "other";

const mapped = (agent: AgentLabel): agent is AgentKind =>
	agent !== "other" && MAPPED_AGENTS.has(agent);

/** The words printed for each verdict. Fixed text only, never a value from the database. */
const VERDICT_WORDS: Record<TranscriptVerdict, string> = {
	match: "match",
	"nothing shown": "mismatch (Conducted shows nothing)",
	"sub-agent text": "mismatch (sub-agent text in the main transcript)",
	turns: "mismatch (turn count)",
	"user text": "mismatch (user text)",
	"agent text": "mismatch (agent text)",
	"tool calls": "mismatch (tool calls)",
};

/**
 * What our chat shows of a chat, read from the turns our chat builds: the user's message and
 * steers, then the top-level text blocks and tool cards. A todo card is the TodoWrite call the
 * Claude translator turned into it, so it reads as that call.
 */
function chatTranscript(turns: readonly ChatTurn[]): TranscriptTurn[] {
	return turns.map((turn) => {
		const user = [turn.userMessage?.text, ...turn.steers.map((steer) => steer.text)].flatMap(
			(text) => {
				const shown = text === undefined ? null : shownText(text);
				return shown === null ? [] : [shown];
			},
		);
		const agent = turn.blocks.flatMap((block): TranscriptEntry[] => {
			if (block.kind === "text") {
				const shown = shownText(block.text);
				return shown === null ? [] : [{ kind: "text", text: shown }];
			}
			if (block.kind === "tool") return [{ kind: "tool", name: block.call.item.rawName }];
			if (block.kind === "todo") return [{ kind: "tool", name: "TodoWrite" }];
			return [];
		});
		return { user, agent };
	});
}

const entries = (turns: readonly TranscriptTurn[]): number =>
	turns.reduce((sum, turn) => sum + turn.user.length + turn.agent.length, 0);

/** Evenly spread picks of `size` out of `count`, in order. */
function picks(count: number, size: number): number[] {
	if (count <= size) return Array.from({ length: count }, (_, index) => index);
	return Array.from({ length: size }, (_, index) => Math.floor((index * count) / size));
}

/** Clones the copy and its log into a new folder of our own, so SQLite never opens the copy. */
function cloneCopy(source: string): { folder: string; path: string } {
	const folder = mkdtempSync(join(tmpdir(), "conducted-spike-"));
	const path = join(folder, "conductor.db");
	copyFileSync(source, path, constants.COPYFILE_FICLONE);
	for (const side of ["-wal", "-journal"]) {
		if (existsSync(`${source}${side}`)) {
			copyFileSync(`${source}${side}`, `${path}${side}`, constants.COPYFILE_FICLONE);
		}
	}
	return { folder, path };
}

/** `sample` is how many chats to read, spread evenly; null reads every chat that has messages. */
export function runSpike(
	source: string,
	sample: number | null,
	print: (line: string) => void,
): boolean {
	const { folder, path } = cloneCopy(source);
	try {
		const db = new Database(path, { readonly: true });
		try {
			return measure(db, sample, print);
		} finally {
			db.close();
		}
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
}

interface ChatResult {
	agent: AgentLabel;
	conductor: TranscriptTurn[];
	ours: TranscriptTurn[];
	/** Null for a chat whose agent the mapping does not handle yet. */
	verdict: TranscriptVerdict | null;
}

function measure(db: Database, sample: number | null, print: (line: string) => void): boolean {
	const chats = db
		.query<{ id: string; agent_type: string | null }, []>(
			`SELECT id, agent_type FROM sessions s
			WHERE EXISTS (SELECT 1 FROM session_messages m WHERE m.session_id = s.id) ORDER BY id`,
		)
		.all();
	const eventsOnly =
		db
			.query<{ total: number }, []>(
				`SELECT COUNT(*) AS total FROM sessions s
				WHERE EXISTS (SELECT 1 FROM session_events e WHERE e.session_id = s.id)
				AND NOT EXISTS (SELECT 1 FROM session_messages m WHERE m.session_id = s.id)`,
			)
			.get()?.total ?? 0;
	// The rows Conductor's chat reads, in the order it reads them (`AA`, main @1538196).
	const messages = db.query<ConductorMessageRow, [string]>(
		`SELECT id, role, content, sent_at, created_at, turn_id FROM session_messages
		WHERE session_id = ? AND sent_at IS NOT NULL ORDER BY sent_at, rowid`,
	);
	const totals = Object.fromEntries(
		ROW_KINDS.map((kind) => [kind, { rows: 0, mapped: 0, unmapped: 0 }]),
	) as Record<(typeof ROW_KINDS)[number], RowCount>;
	const unmapped = Object.fromEntries(UNMAPPED_REASONS.map((reason) => [reason, 0])) as Record<
		(typeof UNMAPPED_REASONS)[number],
		number
	>;
	const leftOut = Object.fromEntries(LEFT_OUT_REASONS.map((reason) => [reason, 0])) as Record<
		(typeof LEFT_OUT_REASONS)[number],
		number
	>;
	let notMappedRows = 0;
	const perChat: ChatResult[] = [];
	for (const index of picks(chats.length, sample ?? chats.length)) {
		const chat = chats[index];
		if (chat === undefined) continue;
		const agent = agentOf(chat.agent_type);
		const rows = messages.all(chat.id);
		const conductor = conductorTranscript(rows);
		if (!mapped(agent)) {
			notMappedRows += rows.length;
			perChat.push({ agent, conductor, ours: [], verdict: null });
			continue;
		}
		const result = mapConductorMessages(rows, { agent, config: { ...SPIKE_CONFIG, agent } });
		for (const kind of ROW_KINDS) {
			totals[kind].rows += result.counts[kind].rows;
			totals[kind].mapped += result.counts[kind].mapped;
			totals[kind].unmapped += result.counts[kind].unmapped;
		}
		for (const reason of UNMAPPED_REASONS) unmapped[reason] += result.unmapped[reason];
		for (const reason of LEFT_OUT_REASONS) leftOut[reason] += result.leftOut[reason];
		const stored = result.events.map((event, idx) => ({
			idx,
			event,
			receivedAt: event.at,
			revertedAt: null,
		}));
		const ours = chatTranscript(buildTurns(stored, idleLiveState));
		perChat.push({ agent, conductor, ours, verdict: compareTranscripts(rows, ours) });
	}
	const all = Object.values(totals).reduce((sum, count) => sum + count.rows, 0);
	const mappedAll = Object.values(totals).reduce((sum, count) => sum + count.mapped, 0);
	const share = all === 0 ? 0 : mappedAll / all;
	const compared = perChat.filter((chat) => chat.verdict !== null);
	const matching = compared.filter((chat) => chat.verdict === "match").length;
	const passed =
		compared.length > 0 && all > 0 && share >= PASS_SHARE && matching === compared.length;

	print("Conductor chat history spike: counts only");
	print(`chats with messages: ${chats.length}`);
	print(`chats with events but no messages: ${eventsOnly}`);
	print(`chats sampled: ${perChat.length}`);
	print("chats by agent (sampled, match, mismatch, not mapped yet):");
	for (const label of AGENT_LABELS) {
		const of = perChat.filter((chat) => chat.agent === label);
		const match = of.filter((chat) => chat.verdict === "match").length;
		const notMapped = of.filter((chat) => chat.verdict === null).length;
		print(`  ${label} ${of.length} ${match} ${of.length - match - notMapped} ${notMapped}`);
	}
	print("chats not mapped yet are left out of the pass mark.");
	print("rows by kind in mapped chats (rows, mapped, unmapped):");
	for (const kind of ROW_KINDS) {
		const count = totals[kind];
		print(`  ${kind} ${count.rows} ${count.mapped} ${count.unmapped}`);
	}
	print(`all rows in mapped chats: ${all}, mapped: ${mappedAll} (${(share * 100).toFixed(1)}%)`);
	print("unmapped rows by reason:");
	for (const reason of UNMAPPED_REASONS) print(`  ${reason} ${unmapped[reason]}`);
	print("mapped rows left out, as Conductor does not show them:");
	for (const reason of LEFT_OUT_REASONS) print(`  ${reason} ${leftOut[reason]}`);
	print(`rows in chats not mapped yet: ${notMappedRows}`);
	print("per chat (agent; Conductor turns, entries; Conducted turns, entries; result):");
	perChat.forEach((chat, index) => {
		const result = chat.verdict === null ? "not mapped yet" : VERDICT_WORDS[chat.verdict];
		print(
			`  chat ${index + 1}: ${chat.agent} ${chat.conductor.length} ${entries(chat.conductor)} ${chat.ours.length} ${entries(chat.ours)} ${result}`,
		);
	});
	print(`mapped chats whose transcript matches: ${matching} of ${compared.length}`);
	print(
		`pass mark (at least 99% of rows mapped and every mapped chat matching): ${passed ? "met" : "not met"}`,
	);
	return passed;
}

function main(argv: readonly string[]): number {
	const [source, flag, value] = argv;
	const sample = flag === "--sample" ? Number(value) : null;
	if (source === undefined || (sample !== null && (!Number.isInteger(sample) || sample < 1))) {
		process.stderr.write(
			"usage: bun scripts/conductor-import/spike.ts <path-to-a-conductor-db-copy> [--sample N]\n",
		);
		return 2;
	}
	if (!existsSync(source) || !statSync(source).isFile()) {
		process.stderr.write("The path given is not a file.\n");
		return 2;
	}
	try {
		runSpike(source, sample, (line) => process.stdout.write(`${line}\n`));
		return 0;
	} catch (error) {
		// The message could quote a row, so only the kind of failure is printed.
		const kind = error instanceof Error ? error.name : typeof error;
		process.stderr.write(`The spike failed (${kind}).\n`);
		return 1;
	}
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
