/**
 * @feature APP-18 The chat history spike: does Conductor's history map whole?
 * Owns: `bun scripts/conductor-import/spike.ts <path-to-a-conductor-db-copy> [--sample N]`. It
 * clones the copy into a folder of its own, opens the clone read-only, maps the events of a sample
 * of chats with the mapping the import will use (packages/sidecar/src/import/conductor-events.ts),
 * and prints counts only: chats sampled, events per event type, mapped and unmapped per type, the
 * mapped share, and for each chat whether the number and order of visible messages match
 * Conductor's own projection (`session_messages`).
 * Behaviour: docs/plans/migrate-from-conductor.md, "The spike first": the pass mark is at least
 * 99% of the sampled events mapped and every mapped chat showing the same visible messages in the
 * same order as Conductor. Below it, chat history does not come over.
 * Must handle: it never prints, logs or returns a value from the database (no text, path, title,
 * name, id or event type it does not know: an unknown type counts as "other"); an error prints its
 * kind only, never its message, which could quote a row; the copy and the folder beside it stay as
 * they were, because SQLite opens only the clone (opening a database creates files beside it); the
 * clone's folder is removed when the run ends, even when it fails. The sample is spread evenly over
 * the chats that have events, in id order, so a second run reads the same chats.
 * Test first: prints counts only, never a value from the database.
 */
import { Database } from "bun:sqlite";
import { constants, copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionConfig } from "../../packages/protocol/src/session-config.ts";
import type { AgentKind } from "../../packages/shared/src/ids.ts";
import {
	CONDUCTOR_EVENT_TYPES,
	type ConductorEventRow,
	type ConductorMessageRow,
	type CountedEventType,
	conductorVisibleSequence,
	mapConductorEvents,
	type TypeCount,
	visibleSequence,
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

const agentOf = (type: string | null): AgentKind =>
	type === "codex" || type === "cursor" || type === "acp" ? type : "claude";

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
	const messages = db.query<ConductorMessageRow, [string]>(
		`SELECT role, sent_at, cancelled_at FROM session_messages
		WHERE session_id = ? ORDER BY COALESCE(sent_at, created_at), rowid`,
	);
	const totals: Record<CountedEventType, TypeCount> = {
		userMessage: { events: 0, mapped: 0, unmapped: 0 },
		agent: { events: 0, mapped: 0, unmapped: 0 },
		checkpointCreated: { events: 0, mapped: 0, unmapped: 0 },
		other: { events: 0, mapped: 0, unmapped: 0 },
	};
	let reverted = 0;
	const perChat: { conductor: number; ours: number; same: boolean }[] = [];
	for (const index of picks(chats.length, sample)) {
		const chat = chats[index];
		if (chat === undefined) continue;
		const agent = agentOf(chat.agent_type);
		const mapped = mapConductorEvents(events.all(chat.id), {
			agent,
			config: { ...SPIKE_CONFIG, agent },
		});
		for (const type of [...CONDUCTOR_EVENT_TYPES, "other"] as const) {
			totals[type].events += mapped.counts[type].events;
			totals[type].mapped += mapped.counts[type].mapped;
			totals[type].unmapped += mapped.counts[type].unmapped;
		}
		reverted += mapped.reverted;
		const conductor = conductorVisibleSequence(messages.all(chat.id));
		const ours = visibleSequence(mapped.events);
		perChat.push({
			conductor: conductor.length,
			ours: ours.length,
			same: conductor.join("") === ours.join(""),
		});
	}
	const all = Object.values(totals).reduce((sum, count) => sum + count.events, 0);
	const mappedAll = Object.values(totals).reduce((sum, count) => sum + count.mapped, 0);
	const share = all === 0 ? 0 : mappedAll / all;
	const matching = perChat.filter((chat) => chat.same).length;
	const passed = all > 0 && share >= PASS_SHARE && matching === perChat.length;

	print("Conductor chat history spike: counts only");
	print(`chats with events: ${chats.length}`);
	print(`chats sampled: ${perChat.length}`);
	print("events by type (events, mapped, unmapped):");
	for (const type of [...CONDUCTOR_EVENT_TYPES, "other"] as const) {
		const count = totals[type];
		print(`  ${type} ${count.events} ${count.mapped} ${count.unmapped}`);
	}
	print(`all events: ${all}, mapped: ${mappedAll} (${(share * 100).toFixed(1)}%)`);
	print(`reverted events left out: ${reverted}`);
	print("per chat (Conductor visible, Conducted visible, same order):");
	perChat.forEach((chat, index) => {
		print(`  chat ${index + 1}: ${chat.conductor} ${chat.ours} ${chat.same ? "yes" : "no"}`);
	});
	print(`chats whose visible messages match: ${matching} of ${perChat.length}`);
	print(`pass mark (at least 99% mapped and every chat matching): ${passed ? "met" : "not met"}`);
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
