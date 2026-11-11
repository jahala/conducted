/**
 * @feature APP-18 The chat history spike: does Conductor's history map whole?
 * Owns: `bun scripts/conductor-import/spike.ts <path-to-a-conductor-db-copy> [--sample N]`. It
 * clones the copy into a folder of its own, opens the clone read-only, maps the events of a sample
 * of chats with the mapping the import will use (packages/sidecar/src/import/conductor-events.ts),
 * and prints counts only: chats sampled per agent, events per event type, mapped and unmapped per
 * type, the mapped share, and for each chat whether its transcript in our chat (the turns our turn
 * builder makes of the mapped events) reads the same as in Conductor's (its `session_messages`
 * rows), as match, mismatch with its first cause, or not mapped yet.
 * Behaviour: docs/plans/migrate-from-conductor.md, "The spike first": the pass mark is at least
 * 99% of the events in the sampled chats the mapping handles mapped, and every such chat reading
 * the same as in Conductor. A chat of an agent the mapping does not handle yet (Codex today) is
 * counted apart and left out of the mark. Below the mark, chat history does not come over.
 * Must handle: it never prints, logs or returns a value from the database (no text, path, title,
 * name, id, agent or event type it does not know: an unknown one counts as "other"); an error
 * prints its kind only, never its message, which could quote a row; the copy and the folder beside
 * it stay as they were, because SQLite opens only the clone (opening a database creates files
 * beside it); the clone's folder is removed when the run ends, even when it fails. The sample is
 * spread evenly over the chats that have events, in id order, so a second run reads the same chats.
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
	CONDUCTOR_EVENT_TYPES,
	type ConductorEventRow,
	type ConductorMessageRow,
	type CountedEventType,
	compareTranscripts,
	conductorTranscript,
	MAPPED_AGENTS,
	mapConductorEvents,
	shownText,
	type TranscriptEntry,
	type TranscriptTurn,
	type TranscriptVerdict,
	type TypeCount,
} from "../../packages/sidecar/src/import/conductor-events.ts";

const DEFAULT_SAMPLE = 25;
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

export function runSpike(source: string, sample: number, print: (line: string) => void): boolean {
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

function measure(db: Database, sample: number, print: (line: string) => void): boolean {
	const chats = db
		.query<{ id: string; agent_type: string | null }, []>(
			`SELECT id, agent_type FROM sessions s
			WHERE EXISTS (SELECT 1 FROM session_events e WHERE e.session_id = s.id) ORDER BY id`,
		)
		.all();
	const events = db.query<ConductorEventRow, [string]>(
		`SELECT event_id, event_type, content, received_at, reverted_at FROM session_events
		WHERE session_id = ? ORDER BY session_index`,
	);
	// The rows Conductor's chat reads, in the order it reads them.
	const messages = db.query<ConductorMessageRow, [string]>(
		`SELECT id, role, content, sent_at, created_at, turn_id FROM session_messages
		WHERE session_id = ? AND sent_at IS NOT NULL ORDER BY sent_at, rowid`,
	);
	const totals: Record<CountedEventType, TypeCount> = {
		userMessage: { events: 0, mapped: 0, unmapped: 0 },
		agent: { events: 0, mapped: 0, unmapped: 0 },
		checkpointCreated: { events: 0, mapped: 0, unmapped: 0 },
		other: { events: 0, mapped: 0, unmapped: 0 },
	};
	let reverted = 0;
	let notMappedEvents = 0;
	const perChat: ChatResult[] = [];
	for (const index of picks(chats.length, sample)) {
		const chat = chats[index];
		if (chat === undefined) continue;
		const agent = agentOf(chat.agent_type);
		const rows = messages.all(chat.id);
		const conductor = conductorTranscript(rows);
		if (!mapped(agent)) {
			notMappedEvents += events.all(chat.id).length;
			perChat.push({ agent, conductor, ours: [], verdict: null });
			continue;
		}
		const result = mapConductorEvents(events.all(chat.id), {
			agent,
			config: { ...SPIKE_CONFIG, agent },
		});
		for (const type of [...CONDUCTOR_EVENT_TYPES, "other"] as const) {
			totals[type].events += result.counts[type].events;
			totals[type].mapped += result.counts[type].mapped;
			totals[type].unmapped += result.counts[type].unmapped;
		}
		reverted += result.reverted;
		const stored = result.events.map((event, idx) => ({
			idx,
			event,
			receivedAt: event.at,
			revertedAt: null,
		}));
		const ours = chatTranscript(buildTurns(stored, idleLiveState));
		perChat.push({ agent, conductor, ours, verdict: compareTranscripts(rows, ours) });
	}
	const all = Object.values(totals).reduce((sum, count) => sum + count.events, 0);
	const mappedAll = Object.values(totals).reduce((sum, count) => sum + count.mapped, 0);
	const share = all === 0 ? 0 : mappedAll / all;
	const compared = perChat.filter((chat) => chat.verdict !== null);
	const matching = compared.filter((chat) => chat.verdict === "match").length;
	const passed =
		compared.length > 0 && all > 0 && share >= PASS_SHARE && matching === compared.length;

	print("Conductor chat history spike: counts only");
	print(`chats with events: ${chats.length}`);
	print(`chats sampled: ${perChat.length}`);
	print("chats by agent (sampled, match, mismatch, not mapped yet):");
	for (const label of AGENT_LABELS) {
		const of = perChat.filter((chat) => chat.agent === label);
		const match = of.filter((chat) => chat.verdict === "match").length;
		const notMapped = of.filter((chat) => chat.verdict === null).length;
		print(`  ${label} ${of.length} ${match} ${of.length - match - notMapped} ${notMapped}`);
	}
	print("chats not mapped yet are left out of the pass mark.");
	print("events by type in mapped chats (events, mapped, unmapped):");
	for (const type of [...CONDUCTOR_EVENT_TYPES, "other"] as const) {
		const count = totals[type];
		print(`  ${type} ${count.events} ${count.mapped} ${count.unmapped}`);
	}
	print(`all events in mapped chats: ${all}, mapped: ${mappedAll} (${(share * 100).toFixed(1)}%)`);
	print(`events in chats not mapped yet: ${notMappedEvents}`);
	print(`reverted events left out: ${reverted}`);
	print("per chat (agent; Conductor turns, entries; Conducted turns, entries; result):");
	perChat.forEach((chat, index) => {
		const result = chat.verdict === null ? "not mapped yet" : VERDICT_WORDS[chat.verdict];
		print(
			`  chat ${index + 1}: ${chat.agent} ${chat.conductor.length} ${entries(chat.conductor)} ${chat.ours.length} ${entries(chat.ours)} ${result}`,
		);
	});
	print(`mapped chats whose transcript matches: ${matching} of ${compared.length}`);
	print(
		`pass mark (at least 99% of events mapped and every mapped chat matching): ${passed ? "met" : "not met"}`,
	);
	return passed;
}

function main(argv: readonly string[]): number {
	const [source, flag, value] = argv;
	const sample = flag === "--sample" ? Number(value) : DEFAULT_SAMPLE;
	if (source === undefined || !Number.isInteger(sample) || sample < 1) {
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
