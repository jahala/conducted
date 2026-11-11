/**
 * @feature APP-18 Chat history from Conductor: writing each chat's history
 * Owns: `importChatHistories`, which brings the history of each chat the plan names, one chat at
 * a time: it reads the chat's rows from the copy through the Rust shell, has the sidecar map them
 * (packages/sidecar/src/import/history-imports.ts) and stores the events as the chat's own.
 * Behaviour: docs/plans/migrate-from-conductor.md ("Chat history"), safety rules 1 (only the copy
 * is read), 3 (all or nothing, here per chat) and 4 (counted and sampled before it commits).
 * Must handle: memory stays bounded by one read, never a chat: the first read pages the chat's
 * rows without their content and the sidecar keeps only their places; the second fetches the rows
 * the sidecar names, at most `rowsPerRead` holding at most `charsPerRead` characters, and the
 * events of each read are written before the next; each chat's events are written in one
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
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { stable } from "./apply.ts";
import type { HistoryChat } from "./plan.ts";

/** How much one read takes. The sidecar's line limit (16 MiB) holds a read's events with room. */
export interface HistoryLimits {
	keysPerPage: number;
	rowsPerRead: number;
	charsPerRead: number;
}

export const HISTORY_LIMITS: HistoryLimits = {
	keysPerPage: 5000,
	rowsPerRead: 1000,
	charsPerRead: 2_000_000,
};

export interface HistoryDeps {
	db: Database;
	repositoriesOn: (db: Database) => Repositories;
	conductorImport: Pick<ConductorImport, "readMessageKeys" | "readMessages">;
	sidecar: Pick<SidecarClient, "request">;
	copyPath: string;
	/** The import's time: when the events are received. */
	now: number;
	limits?: HistoryLimits;
}

export interface HistoryFailure {
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
		if (!brought.ok) outcome.failed.push({ label: chat.label, reason: brought.error.message });
		else if (brought.value === "brought") outcome.chats++;
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
	deps: HistoryDeps,
): Promise<Result<void>> {
	const limits = deps.limits ?? HISTORY_LIMITS;
	let after = 0;
	for (;;) {
		const page = await deps.conductorImport.readMessageKeys(
			deps.copyPath,
			chat.sessionId,
			after,
			limits.keysPerPage,
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

/** The second read, inside the chat's transaction: rows in, events out, written read by read. */
async function writeChat(
	chat: HistoryChat,
	historyId: string,
	tx: Database,
	deps: HistoryDeps,
): Promise<Result<"brought" | "changed">> {
	const limits = deps.limits ?? HISTORY_LIMITS;
	const events = deps.repositoriesOn(tx).sessionEvents;
	const before = await events.count(chat.sessionId);
	if (!before.ok) return before;
	if (before.value > 0) return ok("changed");
	let rows: Awaited<ReturnType<ConductorImport["readMessages"]>> = ok([]);
	let written = 0;
	let first: SessionEvent | undefined;
	for (;;) {
		if (!rows.ok) return rows;
		const mapped = await deps.sidecar.request("mapConductorHistory", {
			historyId,
			rows: rows.value,
			maxRows: limits.rowsPerRead,
			maxChars: limits.charsPerRead,
		});
		if (!mapped.ok) return mapped;
		first ??= mapped.value.events[0];
		const appended = await events.appendMany(chat.sessionId, mapped.value.events, deps.now);
		if (!appended.ok) return appended;
		if (appended.value !== mapped.value.events.length) {
			return err(
				mismatch(`${mapped.value.events.length} events were to be written, ${appended.value} were`),
			);
		}
		written += appended.value;
		if (mapped.value.next === null) break;
		rows = await deps.conductorImport.readMessages(
			deps.copyPath,
			chat.sessionId,
			mapped.value.next,
		);
	}
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

const mismatch = (detail: string) =>
	appError("import_history_mismatch", `${detail}, so the chat's history was not kept.`);
