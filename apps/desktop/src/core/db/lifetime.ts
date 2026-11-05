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
 * failure leaves a row to retry; every step is safe to run twice (a second run finds nothing).
 * Test first: ageCutoff turns a day count into a time, and the cut statement is idempotent.
 */
import type { Clock, Result } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Database, FileSystem } from "../../platform/platform.ts";

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
	 * `$3` events per call, and sets `truncated` so the card says so. A cut result is exactly `$1`
	 * long, so it is not picked again and repeated calls end with zero rows changed.
	 */
	cutToolOutputs: `UPDATE session_events
		SET content = json_set(content, '$.message.items', (
			SELECT json_group_array(json(CASE
				WHEN json_extract(item.value, '$.kind') = 'tool_result'
					AND length(json_extract(item.value, '$.output')) > $1
				THEN json_set(item.value, '$.output',
					substr(json_extract(item.value, '$.output'), 1, $1), '$.truncated', json('true'))
				ELSE item.value END) ORDER BY item.key)
			FROM json_each(session_events.content, '$.message.items') AS item))
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

/** The steps in the order they run. Cheap steps come first, the biggest rewrite last. */
export const LIFETIME_STEPS: readonly LifetimeStep[] = [
	{
		id: "remove-draft-files",
		description:
			"Move `<sessionId>.json` drafts to the Trash when older than the draft limit or when the chat no longer exists. Reads the folder from draftsDir(paths); uses LIFETIME_SQL.filterExistingSessionIds.",
		run: async (_deps) => notImplemented("DATA-02"),
	},
	{
		id: "remove-draft-attachments",
		description:
			"Trash the files of draft attachments older than the attachment limit, then delete their rows in batches. Uses listExpiredDraftAttachments and deleteAttachmentsByIds.",
		run: async (_deps) => notImplemented("DATA-02"),
	},
	{
		id: "remove-ended-terminals",
		description:
			"Trash the scrollback file of each terminal that ended before the terminal limit, then delete its row in batches. Needs a scrollback path function in app-paths.ts, which does not exist yet. Uses listEndedTerminals and deleteTerminalsByIds.",
		run: async (_deps) => notImplemented("DATA-02"),
	},
	{
		id: "cut-tool-outputs",
		description:
			"Cut tool results longer than the size limit in events older than the age limit, repeating cutToolOutputs until a batch changes no rows.",
		run: async (_deps) => notImplemented("DATA-02"),
	},
	{
		id: "compact-archived-chats",
		description:
			"Our design choice: for chats of workspaces archived longer than the compact limit, keep user_message events, turn_ended events, checkpoint events and the last text agent event of each turn (text and usage items only). Drop every other agent event and mark the turn with compacted=true on its turn_ended event, so screens can show 'details removed'. Runs findCompactableTurns, then the three compact statements per turn inside one transaction.",
		run: async (_deps) => notImplemented("DATA-02"),
	},
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

/**
 * Runs the steps in order unless the last run was less than LIFETIME_MIN_INTERVAL_MS ago. It
 * reads the last run time from settings, runs every step even if an earlier one failed, and
 * writes the new time only after all steps were tried. Each step's outcome is in the report.
 */
export async function runDataLifetimeJob(_deps: LifetimeJobDeps): Promise<Result<LifetimeReport>> {
	return notImplemented("DATA-02");
}
