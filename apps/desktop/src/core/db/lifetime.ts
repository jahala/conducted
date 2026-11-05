/**
 * @feature DATA-02 Data-lifetime job
 * Owns: the rules that keep tables and files from growing for ever: cut old tool outputs,
 * compact chats of archived workspaces, remove old draft attachments, ended terminals and
 * draft files.
 * Behaviour: services-map.md 2.7 (data lifetime and cleanup; Conductor has no time-based
 * deletes, so these limits are ours) and the lifetime comments in migration 0001.
 * Must handle: runs at startup after repair (repair.ts) and then at most once per day, with the
 * last run time kept in the settings table; each step is independent, so one failing step does
 * not stop the next and the report lists every outcome; steps never block the UI because they
 * work in batches (`LIMIT` on every delete and update) and yield between batches; user files
 * only go to the Trash through `fs.trash`, and a file is trashed before its row is deleted so a
 * failure leaves a row to retry; a stored attachment path is trashed only when it lies inside the
 * draft attachment folder, so a row that points at the user's own file loses its row, keeps the
 * file, and fails its step with the path named; every step is safe to run twice (a second run
 * finds nothing); `lifetimeJobResult` turns the steps that failed into one error, so the startup
 * step reports them as a start warning instead of hiding them inside the report.
 * Test first: ageCutoff turns a day count into a time, and the cut statement is idempotent.
 */
import { appError, type Clock, err, ok, type Result } from "@conducted/shared";
import type { Database, FileSystem } from "../../platform/platform.ts";
import {
	draftAttachmentsRoot,
	draftsDir,
	isInsideFolder,
	terminalHistoryFile,
} from "../app-paths.ts";
import {
	executeStatement,
	inTransaction,
	parseJsonText,
	selectRows,
	stringifyJson,
} from "./row-codec.ts";
import { SETTINGS_SQL } from "./settings.ts";

/** The limits come from settings. Days count from the event, row or file time. */
export interface LifetimeLimits {
	/** Tool outputs of events older than this many days may be cut. */
	toolOutputMaxAgeDays: number;
	/** A tool output longer than this is cut to this length. Counted in characters. */
	toolOutputMaxBytes: number;
	/** Chats of archived workspaces are compacted this many days after the archive. */
	archivedChatCompactAfterDays: number;
	/** Draft attachments older than this many days are removed with their files. */
	draftAttachmentMaxAgeDays: number;
	/** Ended terminals older than this many days are removed with their scrollback files. */
	endedTerminalMaxAgeDays: number;
	/** Draft files older than this many days are moved to the Trash. */
	draftFileMaxAgeDays: number;
}

export const DEFAULT_LIFETIME_LIMITS: LifetimeLimits = {
	toolOutputMaxAgeDays: 30,
	toolOutputMaxBytes: 100_000,
	archivedChatCompactAfterDays: 90,
	draftAttachmentMaxAgeDays: 7,
	endedTerminalMaxAgeDays: 14,
	draftFileMaxAgeDays: 30,
};

export const MS_PER_DAY = 86_400_000;

/** The job runs at most once in this many milliseconds. */
export const LIFETIME_MIN_INTERVAL_MS = MS_PER_DAY;

/** Rows handled per statement, so one step never holds the database for long. */
export const LIFETIME_BATCH_SIZE = 200;

/** Settings key that holds the time of the last finished run, as JSON. */
export const LIFETIME_LAST_RUN_KEY = "data_lifetime_last_run_at";

/** The time before which something counts as old. */
export const ageCutoff = (now: number, days: number): number => now - days * MS_PER_DAY;

/** The agent event of a turn that keeps its text: the last one with a text item. Needs `$1`, `$2`. */
const KEEP_FINAL_TEXT_EVENT = `(
	SELECT k.idx FROM session_events k
	WHERE k.session_id = $1 AND k.turn_id = $2 AND k.type = 'agent'
		AND EXISTS (SELECT 1 FROM json_each(k.content, '$.message.items') AS i
			WHERE json_extract(i.value, '$.kind') = 'text')
	ORDER BY k.idx DESC LIMIT 1)`;

/**
 * Every statement the job runs. Parameters are `$1..$n` in order of first appearance. The cut and
 * compact statements rebuild JSON arrays with `json_group_array(x ORDER BY y)`, which needs
 * SQLite 3.44 or newer.
 */
export const LIFETIME_SQL = {
	/**
	 * Cuts tool results longer than `$1` characters in agent events received before `$2`, at most
	 * `$3` events per call, sets `compacted_at` to `$4` and sets `truncated` so the card says so.
	 * A cut result is exactly `$1` long, so it is not picked again and repeated calls end with zero
	 * rows changed.
	 */
	cutToolOutputs: `UPDATE session_events
		SET content = json_set(content, '$.message.items', (
			SELECT json_group_array(json(CASE
				WHEN json_extract(item.value, '$.kind') = 'tool_result'
					AND length(json_extract(item.value, '$.output')) > $1
				THEN json_set(item.value, '$.output',
					substr(json_extract(item.value, '$.output'), 1, $1), '$.truncated', json('true'))
				ELSE item.value END) ORDER BY item.key)
			FROM json_each(session_events.content, '$.message.items') AS item)),
			compacted_at = $4
		WHERE rowid IN (
			SELECT e.rowid FROM session_events e
			WHERE e.type = 'agent' AND e.received_at < $2 AND length(e.content) > $1
				AND EXISTS (SELECT 1 FROM json_each(e.content, '$.message.items') AS i
					WHERE json_extract(i.value, '$.kind') = 'tool_result'
						AND length(json_extract(i.value, '$.output')) > $1)
			ORDER BY e.rowid LIMIT $3)`,

	/**
	 * Turns not yet compacted whose workspace was archived before `$1` (the archive time is the
	 * workspace's archived_at, set by migration 0002; updated_at moves with every later edit), at
	 * most `$2`. A workspace with no archived_at is left alone. Each row feeds the three compact
	 * statements below.
	 */
	findCompactableTurns: `SELECT t.session_id, t.turn_id FROM session_events t
		JOIN sessions s ON s.id = t.session_id
		JOIN workspaces w ON w.id = s.workspace_id
		WHERE t.type = 'turn_ended' AND json_extract(t.content, '$.compacted') IS NULL
			AND w.state = 'archived' AND w.archived_at < $1
		ORDER BY t.session_id, t.idx LIMIT $2`,
	/** Compact step 1 (`$1` session, `$2` turn): the last event with text keeps only text and usage. */
	compactStripKeptEvent: `UPDATE session_events
		SET content = json_remove(
			json_set(content, '$.message.items', (
				SELECT json_group_array(json(item.value) ORDER BY item.key)
				FROM json_each(session_events.content, '$.message.items') AS item
				WHERE json_extract(item.value, '$.kind') IN ('text', 'usage'))),
			'$.message.raw')
		WHERE session_id = $1 AND turn_id = $2 AND idx = ${KEEP_FINAL_TEXT_EVENT}`,
	/** Compact step 2 (`$1` session, `$2` turn): every other agent event of the turn goes. */
	compactDropOtherAgentEvents: `DELETE FROM session_events
		WHERE session_id = $1 AND turn_id = $2 AND type = 'agent'
			AND idx IS NOT ${KEEP_FINAL_TEXT_EVENT}`,
	/** Compact step 3 (`$1` session, `$2` turn): marks the turn so screens show "details removed". */
	compactMarkTurnEnded: `UPDATE session_events
		SET content = json_set(content, '$.compacted', json('true'))
		WHERE session_id = $1 AND turn_id = $2 AND type = 'turn_ended'`,

	/** Draft attachments created before `$1`, oldest first, at most `$2`. */
	listExpiredDraftAttachments: `SELECT id, path FROM attachments
		WHERE is_draft = 1 AND created_at < $1 ORDER BY created_at, id LIMIT $2`,
	/** `$1` is a JSON list of attachment ids. Run after their files are in the Trash. */
	deleteAttachmentsByIds: "DELETE FROM attachments WHERE id IN (SELECT value FROM json_each($1))",

	/** Terminals that ended before `$1`, oldest first, at most `$2`. */
	listEndedTerminals: `SELECT id FROM terminals
		WHERE ended_at IS NOT NULL AND ended_at < $1 ORDER BY ended_at, id LIMIT $2`,
	/** `$1` is a JSON list of terminal ids. Run after their scrollback files are in the Trash. */
	deleteTerminalsByIds: "DELETE FROM terminals WHERE id IN (SELECT value FROM json_each($1))",

	/** Which of the chat ids in the JSON list `$1` still exist. */
	filterExistingSessionIds: "SELECT id FROM sessions WHERE id IN (SELECT value FROM json_each($1))",
} as const;

export interface LifetimeStepDeps {
	db: Database;
	fs: FileSystem;
	clock: Clock;
	limits: LifetimeLimits;
}

export interface LifetimeStepReport {
	/** Rows deleted or rewritten. */
	rowsChanged: number;
	/** Files moved to the Trash. */
	filesTrashed: number;
}

export type LifetimeStepId =
	| "cut-tool-outputs"
	| "compact-archived-chats"
	| "remove-draft-attachments"
	| "remove-ended-terminals"
	| "remove-draft-files";

export interface LifetimeStep {
	id: LifetimeStepId;
	description: string;
	run(deps: LifetimeStepDeps): Promise<Result<LifetimeStepReport>>;
}

const nothingDone = (): LifetimeStepReport => ({ rowsChanged: 0, filesTrashed: 0 });

const addReport = (total: LifetimeStepReport, part: LifetimeStepReport): LifetimeStepReport => ({
	rowsChanged: total.rowsChanged + part.rowsChanged,
	filesTrashed: total.filesTrashed + part.filesTrashed,
});

/** Gives the UI a turn between batches instead of holding the event loop. */
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const fileId = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const draftSessionId = (path: string): string => {
	const name = fileId(path);
	return name.endsWith(".json") ? name.slice(0, -".json".length) : name;
};

const missingFolder = (error: { code: string }): boolean => error.code === "fs_not_found";

/** Which of these chat ids still have a row. */
async function existingSessionIds(db: Database, ids: string[]): Promise<Result<Set<string>>> {
	if (ids.length === 0) return ok(new Set());
	const json = stringifyJson(ids, "draft session ids");
	if (!json.ok) return json;
	const rows = await selectRows<{ id: string }>(
		db,
		LIFETIME_SQL.filterExistingSessionIds,
		[json.value],
		"Finding chats that still exist",
	);
	return rows.ok ? ok(new Set(rows.value.map((row) => row.id))) : rows;
}

interface FolderScan {
	/** The newest modified time of any file below the folder. Zero when it holds no files. */
	newestAt: number;
	files: number;
}

/** Counts the files below a folder and finds the newest one, so an old folder can be removed. */
async function scanFolder(fs: FileSystem, folder: string): Promise<Result<FolderScan>> {
	const listing = await fs.readDir(folder);
	if (!listing.ok) return listing;
	let newestAt = 0;
	let files = 0;
	for (const entry of listing.value) {
		if (entry.isDirectory) {
			const nested = await scanFolder(fs, entry.path);
			if (!nested.ok) return nested;
			newestAt = Math.max(newestAt, nested.value.newestAt);
			files += nested.value.files;
		} else {
			newestAt = Math.max(newestAt, entry.modifiedAt);
			files += 1;
		}
	}
	return ok({ newestAt, files });
}

/** Trashes staging folders whose files are all older than the cutoff, counting the files. */
async function sweepStagingFolders(fs: FileSystem, cutoff: number): Promise<Result<number>> {
	const listing = await fs.readDir(draftAttachmentsRoot(fs.paths));
	if (!listing.ok) return missingFolder(listing.error) ? ok(0) : listing;
	let trashed = 0;
	for (const entry of listing.value) {
		if (!entry.isDirectory) {
			if (entry.modifiedAt >= cutoff) continue;
			const removed = await fs.trash(entry.path);
			if (!removed.ok) return removed;
			trashed += 1;
			continue;
		}
		const scanned = await scanFolder(fs, entry.path);
		if (!scanned.ok) return scanned;
		if (scanned.value.newestAt >= cutoff) continue;
		const removed = await fs.trash(entry.path);
		if (!removed.ok) return removed;
		trashed += scanned.value.files;
	}
	return ok(trashed);
}

/** Moves a file to the Trash when it is there; a missing file is already clean. */
async function trashIfPresent(fs: FileSystem, path: string): Promise<Result<boolean>> {
	if (!(await fs.exists(path))) return ok(false);
	const removed = await fs.trash(path);
	return removed.ok ? ok(true) : removed;
}

const removeDraftFiles: LifetimeStep = {
	id: "remove-draft-files",
	description:
		"Move `<sessionId>.json` drafts to the Trash when older than the draft limit or when the chat no longer exists.",
	run: async ({ db, fs, clock, limits }) => {
		const listing = await fs.readDir(draftsDir(fs.paths));
		if (!listing.ok) return missingFolder(listing.error) ? ok(nothingDone()) : listing;
		const files = listing.value.filter((entry) => !entry.isDirectory);
		const cutoff = ageCutoff(clock.now(), limits.draftFileMaxAgeDays);
		let report = nothingDone();
		for (let start = 0; start < files.length; start += LIFETIME_BATCH_SIZE) {
			const batch = files.slice(start, start + LIFETIME_BATCH_SIZE);
			const existing = await existingSessionIds(
				db,
				batch.map((entry) => draftSessionId(entry.path)),
			);
			if (!existing.ok) return existing;
			for (const entry of batch) {
				const expired = entry.modifiedAt < cutoff;
				const orphaned = !existing.value.has(draftSessionId(entry.path));
				if (!expired && !orphaned) continue;
				const removed = await trashIfPresent(fs, entry.path);
				if (!removed.ok) return removed;
				if (removed.value) report = addReport(report, { rowsChanged: 0, filesTrashed: 1 });
			}
			await yieldToUi();
		}
		return ok(report);
	},
};

const removeDraftAttachments: LifetimeStep = {
	id: "remove-draft-attachments",
	description:
		"Trash the files of draft attachments older than the attachment limit, delete their rows in batches, then empty old staging folders.",
	run: async ({ db, fs, clock, limits }) => {
		const cutoff = ageCutoff(clock.now(), limits.draftAttachmentMaxAgeDays);
		const root = draftAttachmentsRoot(fs.paths);
		// Rows whose path is not inside the attachment folder. Their files are not the app's to trash.
		const outside: string[] = [];
		let report = nothingDone();
		for (;;) {
			const listed = await selectRows<{ id: string; path: string }>(
				db,
				LIFETIME_SQL.listExpiredDraftAttachments,
				[cutoff, LIFETIME_BATCH_SIZE],
				"Listing old draft attachments",
			);
			if (!listed.ok) return listed;
			if (listed.value.length === 0) break;
			const ids: string[] = [];
			for (const row of listed.value) {
				ids.push(row.id);
				if (!isInsideFolder(root, row.path)) {
					outside.push(row.path);
					continue;
				}
				const removed = await trashIfPresent(fs, row.path);
				if (!removed.ok) return removed;
				if (removed.value) report = addReport(report, { rowsChanged: 0, filesTrashed: 1 });
			}
			const json = stringifyJson(ids, "old draft attachment ids");
			if (!json.ok) return json;
			const deleted = await executeStatement(
				db,
				LIFETIME_SQL.deleteAttachmentsByIds,
				[json.value],
				"Removing old draft attachments",
			);
			if (!deleted.ok) return deleted;
			report = addReport(report, { rowsChanged: deleted.value, filesTrashed: 0 });
			await yieldToUi();
		}
		const swept = await sweepStagingFolders(fs, cutoff);
		if (!swept.ok) return swept;
		if (outside.length > 0) {
			return err(
				appError(
					"data_lifetime_path_outside",
					`${outside.length} old draft attachment${outside.length === 1 ? "" : "s"} pointed outside the app's attachment folder. Their rows were removed and the files were left in place: ${outside.join(", ")}`,
				),
			);
		}
		return ok(addReport(report, { rowsChanged: 0, filesTrashed: swept.value }));
	},
};

const removeEndedTerminals: LifetimeStep = {
	id: "remove-ended-terminals",
	description:
		"Trash the scrollback file of each terminal that ended before the terminal limit, then delete its row in batches.",
	run: async ({ db, fs, clock, limits }) => {
		const cutoff = ageCutoff(clock.now(), limits.endedTerminalMaxAgeDays);
		let report = nothingDone();
		for (;;) {
			const listed = await selectRows<{ id: string }>(
				db,
				LIFETIME_SQL.listEndedTerminals,
				[cutoff, LIFETIME_BATCH_SIZE],
				"Listing old terminals",
			);
			if (!listed.ok) return listed;
			if (listed.value.length === 0) break;
			const ids: string[] = [];
			for (const row of listed.value) {
				ids.push(row.id);
				const removed = await trashIfPresent(fs, terminalHistoryFile(fs.paths, row.id));
				if (!removed.ok) return removed;
				if (removed.value) report = addReport(report, { rowsChanged: 0, filesTrashed: 1 });
			}
			const json = stringifyJson(ids, "old terminal ids");
			if (!json.ok) return json;
			const deleted = await executeStatement(
				db,
				LIFETIME_SQL.deleteTerminalsByIds,
				[json.value],
				"Removing old terminals",
			);
			if (!deleted.ok) return deleted;
			report = addReport(report, { rowsChanged: deleted.value, filesTrashed: 0 });
			await yieldToUi();
		}
		return ok(report);
	},
};

const cutToolOutputs: LifetimeStep = {
	id: "cut-tool-outputs",
	description:
		"Cut tool results longer than the size limit in events older than the age limit, repeating cutToolOutputs until a batch changes no rows.",
	run: async ({ db, clock, limits }) => {
		const now = clock.now();
		const cutoff = ageCutoff(now, limits.toolOutputMaxAgeDays);
		let rowsChanged = 0;
		for (;;) {
			const updated = await executeStatement(
				db,
				LIFETIME_SQL.cutToolOutputs,
				[limits.toolOutputMaxBytes, cutoff, LIFETIME_BATCH_SIZE, now],
				"Cutting old tool outputs",
			);
			if (!updated.ok) return updated;
			rowsChanged += updated.value;
			if (updated.value === 0) break;
			await yieldToUi();
		}
		return ok({ rowsChanged, filesTrashed: 0 });
	},
};

const compactArchivedChats: LifetimeStep = {
	id: "compact-archived-chats",
	description:
		"Our design choice: for chats of workspaces archived longer than the compact limit, keep user_message events, turn_ended events, checkpoint events and the last text agent event of each turn (text and usage items only). Drop every other agent event and mark the turn with compacted=true on its turn_ended event, so screens can show 'details removed'.",
	run: async ({ db, clock, limits }) => {
		const cutoff = ageCutoff(clock.now(), limits.archivedChatCompactAfterDays);
		let rowsChanged = 0;
		for (;;) {
			const turns = await selectRows<{ session_id: string; turn_id: string }>(
				db,
				LIFETIME_SQL.findCompactableTurns,
				[cutoff, LIFETIME_BATCH_SIZE],
				"Finding old chats to compact",
			);
			if (!turns.ok) return turns;
			if (turns.value.length === 0) break;
			for (const turn of turns.value) {
				const compacted = await compactTurn(db, turn.session_id, turn.turn_id);
				if (!compacted.ok) return compacted;
				rowsChanged += compacted.value;
			}
			await yieldToUi();
		}
		return ok({ rowsChanged, filesTrashed: 0 });
	},
};

/** Runs the three compact statements for one turn in one transaction. */
async function compactTurn(
	db: Database,
	sessionId: string,
	turnId: string,
): Promise<Result<number>> {
	return inTransaction(db, "Compacting an archived chat", async (tx) => {
		const stripped = await executeStatement(
			tx,
			LIFETIME_SQL.compactStripKeptEvent,
			[sessionId, turnId],
			"Stripping a kept event",
		);
		if (!stripped.ok) return stripped;
		const dropped = await executeStatement(
			tx,
			LIFETIME_SQL.compactDropOtherAgentEvents,
			[sessionId, turnId],
			"Dropping old agent events",
		);
		if (!dropped.ok) return dropped;
		const marked = await executeStatement(
			tx,
			LIFETIME_SQL.compactMarkTurnEnded,
			[sessionId, turnId],
			"Marking a turn compacted",
		);
		if (!marked.ok) return marked;
		return ok(stripped.value + dropped.value + marked.value);
	});
}

/** The steps in the order they run. Cheap steps come first, the biggest rewrite last. */
export const LIFETIME_STEPS: readonly LifetimeStep[] = [
	removeDraftFiles,
	removeDraftAttachments,
	removeEndedTerminals,
	cutToolOutputs,
	compactArchivedChats,
];

export interface LifetimeJobDeps {
	db: Database;
	fs: FileSystem;
	clock: Clock;
	limits: LifetimeLimits;
}

export type LifetimeReport =
	| { kind: "skipped"; lastRunAt: number }
	| {
			kind: "ran";
			startedAt: number;
			steps: { id: LifetimeStepId; outcome: Result<LifetimeStepReport> }[];
	  };

/** Reads when the job last ran. A missing row means it has never run. */
async function readLastRunAt(db: Database): Promise<Result<number | null>> {
	const rows = await selectRows<{ value: string }>(
		db,
		SETTINGS_SQL.get,
		[LIFETIME_LAST_RUN_KEY],
		"Reading the data-lifetime last run",
	);
	if (!rows.ok) return rows;
	const row = rows.value[0];
	if (row === undefined) return ok(null);
	const parsed = parseJsonText(row.value, `settings.value for ${LIFETIME_LAST_RUN_KEY}`);
	if (!parsed.ok) return parsed;
	if (typeof parsed.value !== "number") {
		return err(
			appError("data_lifetime_bad_last_run", "The data-lifetime last-run time is not a number."),
		);
	}
	return ok(parsed.value);
}

/** Stores when the job last ran. */
async function writeLastRunAt(db: Database, at: number): Promise<Result<void>> {
	const json = stringifyJson(at, `settings.value for ${LIFETIME_LAST_RUN_KEY}`);
	if (!json.ok) return json;
	const written = await executeStatement(
		db,
		SETTINGS_SQL.upsert,
		[LIFETIME_LAST_RUN_KEY, json.value, at],
		"Saving the data-lifetime last run",
	);
	return written.ok ? ok(undefined) : written;
}

const errorFor = (step: LifetimeStepId, cause: unknown) =>
	appError("data_lifetime_step_failed", `The data-lifetime step ${step} failed.`, cause);

/**
 * The job's outcome for the startup step. A report whose steps all succeeded, or a skipped run,
 * is returned as it is. A report with failed steps becomes one error that names each failed step,
 * so the failure reaches the start warnings instead of staying inside the report.
 */
export function lifetimeJobResult(report: LifetimeReport): Result<LifetimeReport> {
	if (report.kind === "skipped") return ok(report);
	const failed: string[] = [];
	for (const step of report.steps) {
		if (!step.outcome.ok) failed.push(`${step.id}: ${step.outcome.error.message}`);
	}
	if (failed.length === 0) return ok(report);
	return err(
		appError(
			"data_lifetime_steps_failed",
			`Old data was not fully cleaned up. ${failed.join(" ")}`,
		),
	);
}

/**
 * Runs the steps in order unless the last run was less than LIFETIME_MIN_INTERVAL_MS ago. It
 * reads the last run time from settings, runs every step even if an earlier one failed, and
 * writes the new time only after all steps were tried. Each step's outcome is in the report.
 */
export async function runDataLifetimeJob(deps: LifetimeJobDeps): Promise<Result<LifetimeReport>> {
	const now = deps.clock.now();
	const lastRun = await readLastRunAt(deps.db);
	if (!lastRun.ok) return lastRun;
	if (lastRun.value !== null && now - lastRun.value < LIFETIME_MIN_INTERVAL_MS) {
		return ok({ kind: "skipped", lastRunAt: lastRun.value });
	}
	const steps: { id: LifetimeStepId; outcome: Result<LifetimeStepReport> }[] = [];
	for (const step of LIFETIME_STEPS) {
		let outcome: Result<LifetimeStepReport>;
		try {
			outcome = await step.run({
				db: deps.db,
				fs: deps.fs,
				clock: deps.clock,
				limits: deps.limits,
			});
		} catch (cause) {
			outcome = err(errorFor(step.id, cause));
		}
		steps.push({ id: step.id, outcome });
	}
	const written = await writeLastRunAt(deps.db, now);
	if (!written.ok) return written;
	return ok({ kind: "ran", startedAt: now, steps });
}
