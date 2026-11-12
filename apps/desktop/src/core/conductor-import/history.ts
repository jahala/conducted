/**
 * @feature APP-18 Chat history from Conductor: writing each chat's history
 * Owns: `importChatHistories`, which brings the history of each chat the plan names, one chat at
 * a time: it reads the chat's rows from the copy through the Rust shell, has the sidecar map them
 * (packages/sidecar/src/import/history-imports.ts) and stores the events as the chat's own;
 * `measureChatHistories`, the dry run's pass over the same reads and mapping, which sizes each
 * event as the writer stores it and writes nothing (D132).
 * Behaviour: docs/plans/migrate-from-conductor.md ("Chat history"), safety rules 1 (only the copy
 * is read), 3 (all or nothing, here per chat) and 4 (counted and sampled before it commits).
 * Must handle: memory stays bounded by one read, never a chat: the first read pages the chat's
 * rows without their content and the sidecar keeps only their places; the second fetches the rows
 * the sidecar names, at most `rowsPerRead` holding at most `charsPerRead` characters, and the
 * events of each read are written before the next; a message too large for the sidecar's line
 * fails its chat with that reason, before it is sent; each chat's events are written in one
 * transaction, which also counts them and reads the first back, so a failure leaves the chat
 * without history and never half of it; a failed chat is named with its reason and the next
 * chat goes on; a chat that gained an event since the dry run (the user sent a message) is left
 * as it is and counted, never added to; the sidecar's mapping is closed whatever happens.
 * Our design choice: an imported event is received at the import's time, while its own time
 * (`at`) is Conductor's, so the chat shows when things happened and the data lifetime job, which
 * ages events by when they were received, treats imported events as events received at import.
 * The first read happens before the transaction, which holds the app's one database queue, so
 * the time other writes wait is the second read only.
 * Test first: a Claude chat with several turns comes over, and our chat shows those turns.
 */
import type { SessionEvent } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import type { ConductorImport, Database } from "../../platform/platform.ts";
import type { Repositories } from "../db/repositories.ts";
import { inTransaction } from "../db/row-codec.ts";
import { storedEventBytes } from "../db/session-events.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { stable } from "./apply.ts";
import { type HistoryChat, type HistorySize, TablePages } from "./plan.ts";

/**
 * How much one read takes. The sidecar reads lines of at most 16 MiB characters, so a read's rows
 * and their events fit with room. A read holds at least one row, so one row larger than
 * `charsPerRead` is read alone; past `maxReadChars` it cannot cross the line, even escaped.
 */
export interface HistoryLimits {
	keysPerPage: number;
	rowsPerRead: number;
	charsPerRead: number;
	maxReadChars: number;
}

export const HISTORY_LIMITS: HistoryLimits = {
	keysPerPage: 5000,
	rowsPerRead: 1000,
	charsPerRead: 2_000_000,
	maxReadChars: 6_000_000,
};

/** What reading and mapping a chat needs: the copy's two reads and the sidecar's mapping. */
export interface ReadDeps {
	conductorImport: Pick<ConductorImport, "readMessageKeys" | "readMessages">;
	sidecar: Pick<SidecarClient, "request">;
	copyPath: string;
}

export interface HistoryDeps extends ReadDeps {
	db: Database;
	repositoriesOn: (db: Database) => Repositories;
	/** The import's time: when the events are received. */
	now: number;
}

export interface HistoryFailure {
	sessionId: string;
	label: string;
	reason: string;
}

export interface HistoryOutcome {
	/** Chats whose history came over. */
	chats: number;
	/** Chats that gained an event since the dry run, left as they are. */
	changed: number;
	failed: HistoryFailure[];
}

/** Brings each chat's history in turn. A chat's failure is recorded and the rest go on. */
export async function importChatHistories(
	chats: readonly HistoryChat[],
	deps: HistoryDeps,
): Promise<HistoryOutcome> {
	const outcome: HistoryOutcome = { chats: 0, changed: 0, failed: [] };
	for (const chat of chats) {
		const brought = await importOne(chat, deps);
		if (!brought.ok) {
			outcome.failed.push({
				sessionId: chat.sessionId,
				label: chat.label,
				reason: brought.error.message,
			});
		} else if (brought.value === "brought") outcome.chats++;
		else outcome.changed++;
	}
	return outcome;
}

async function importOne(
	chat: HistoryChat,
	deps: HistoryDeps,
): Promise<Result<"brought" | "changed">> {
	const historyId = `${deps.now}:${chat.sessionId}`;
	// A mapping an earlier run left open under this id must not take this run's rows.
	const cleared = await deps.sidecar.request("closeConductorHistory", { historyId });
	if (!cleared.ok) return cleared;
	try {
		const indexed = await indexChat(chat, historyId, deps);
		if (!indexed.ok) return indexed;
		return await inTransaction(deps.db, "Writing a chat's history", (tx) =>
			writeChat(chat, historyId, tx, deps),
		);
	} finally {
		// A failed close leaves nothing behind: the sidecar drops a mapping when a newer one opens.
		await deps.sidecar.request("closeConductorHistory", { historyId });
	}
}

/** The first read: every row of the chat without its content, a page at a time. */
async function indexChat(
	chat: HistoryChat,
	historyId: string,
	deps: ReadDeps,
): Promise<Result<void>> {
	let after = 0;
	for (;;) {
		const page = await deps.conductorImport.readMessageKeys(
			deps.copyPath,
			chat.sessionId,
			after,
			HISTORY_LIMITS.keysPerPage,
		);
		if (!page.ok) return page;
		const last = page.value.at(-1);
		if (last === undefined) return ok(undefined);
		const indexed = await deps.sidecar.request("indexConductorHistory", {
			historyId,
			agent: chat.agent,
			config: chat.config,
			keys: page.value,
		});
		if (!indexed.ok) return indexed;
		after = last.rowid;
	}
}

/**
 * The second read: rows in, events out, a read at a time, each read's events given to `take`
 * before the next read. A message too large for the sidecar's line stops it with that reason.
 */
async function eachRead(
	chat: HistoryChat,
	historyId: string,
	deps: ReadDeps,
	take: (events: readonly SessionEvent[]) => Promise<Result<void>>,
): Promise<Result<void>> {
	const limits = HISTORY_LIMITS;
	let rows: Awaited<ReturnType<ConductorImport["readMessages"]>> = ok([]);
	for (;;) {
		if (!rows.ok) return rows;
		const chars = rows.value.reduce((sum, row) => sum + (row.content?.length ?? 0), 0);
		if (chars > limits.maxReadChars) {
			return err(
				appError(
					"import_history_too_large",
					`A message in it holds ${chars.toLocaleString("en-US")} characters, more than the import can carry.`,
				),
			);
		}
		const mapped = await deps.sidecar.request("mapConductorHistory", {
			historyId,
			rows: rows.value,
			maxRows: limits.rowsPerRead,
			maxChars: limits.charsPerRead,
		});
		if (!mapped.ok) return mapped;
		const taken = await take(mapped.value.events);
		if (!taken.ok) return taken;
		if (mapped.value.next === null) return ok(undefined);
		rows = await deps.conductorImport.readMessages(
			deps.copyPath,
			chat.sessionId,
			mapped.value.next,
		);
	}
}

/** Inside the chat's transaction: the second read, written read by read, then checked. */
async function writeChat(
	chat: HistoryChat,
	historyId: string,
	tx: Database,
	deps: HistoryDeps,
): Promise<Result<"brought" | "changed">> {
	const events = deps.repositoriesOn(tx).sessionEvents;
	const before = await events.count(chat.sessionId);
	if (!before.ok) return before;
	if (before.value > 0) return ok("changed");
	let written = 0;
	let first: SessionEvent | undefined;
	const read = await eachRead(chat, historyId, deps, async (mapped) => {
		first ??= mapped[0];
		const appended = await events.appendMany(chat.sessionId, mapped, deps.now);
		if (!appended.ok) return appended;
		if (appended.value !== mapped.length) {
			return err(mismatch(`${mapped.length} events were to be written, ${appended.value} were`));
		}
		written += appended.value;
		return ok(undefined);
	});
	if (!read.ok) return read;
	const after = await events.count(chat.sessionId);
	if (!after.ok) return after;
	if (after.value !== written) {
		return err(mismatch(`${written} events were written, but ${after.value} are there`));
	}
	if (first !== undefined) {
		const sample = await events.listFrom(chat.sessionId, 0, 1);
		if (!sample.ok) return sample;
		if (stable(sample.value[0]?.event) !== stable(first)) {
			return err(mismatch("The first event read back differs from what was written"));
		}
	}
	return ok("brought");
}

export interface MeasureDeps extends ReadDeps {
	/** The dry run's time, which keeps its mappings apart from an import's. */
	now: number;
	/** True once the user cancelled the dry run: the chats not yet measured are not. */
	cancelled: () => boolean;
}

/**
 * The dry run's measure of the history it would bring (D132): each chat read and mapped as the
 * import does, every event sized as the writer stores it, nothing written. A chat whose mapping
 * fails counts what it mapped before the failure, as the import writes that much before it rolls
 * the chat back.
 */
export async function measureChatHistories(
	chats: readonly HistoryChat[],
	deps: MeasureDeps,
): Promise<HistorySize> {
	const all = new TablePages();
	let largestChatDiskBytes = 0;
	for (const chat of chats) {
		if (deps.cancelled()) break;
		// Its own id, so a mapping the dry run leaves open is never the import's.
		const historyId = `${deps.now}:${chat.sessionId}:size`;
		const one = new TablePages();
		const cleared = await deps.sidecar.request("closeConductorHistory", { historyId });
		if (cleared.ok) {
			try {
				const indexed = await indexChat(chat, historyId, deps);
				if (indexed.ok) {
					await eachRead(chat, historyId, deps, async (mapped) => {
						for (const event of mapped) {
							const stored = storedEventBytes(chat.sessionId, event);
							if (!stored.ok) return stored;
							all.add(stored.value);
							one.add(stored.value);
						}
						return ok(undefined);
					});
				}
			} finally {
				await deps.sidecar.request("closeConductorHistory", { historyId });
			}
		}
		largestChatDiskBytes = Math.max(largestChatDiskBytes, one.diskBytes);
	}
	return { diskBytes: all.diskBytes, largestChatDiskBytes };
}

const mismatch = (detail: string) =>
	appError("import_history_mismatch", `${detail}, so the chat's history was not kept.`);
