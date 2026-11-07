/**
 * @feature DATA-01 Repository for the terminals table
 * Owns: terminal tabs and script runs (setup, run, spotlight) of a workspace, and the one
 * terminal of each repository (workspace_id null, repo_id set; migration 0004). A terminal also
 * says which host it runs on (host_kind, migration 0016, CLOUD-11). Scrollback files
 * are written by the Rust shell and not touched here; the screen state for a restore is a JSON
 * column.
 * Behaviour: services-map.md 2.3.5 (terminal_sessions: upsert, delete) and 5A (terminals).
 * Must handle: marking ended is compare-and-set on ended_at IS NULL, so the first exit report
 * wins; a crash leaves rows with ended_at NULL, which startup repair closes (repair.ts); ended
 * terminals older than 14 days are removed with their files by the lifetime job (lifetime.ts).
 * Test first: markEnded twice keeps the first exit code.
 */
import {
	err,
	ok,
	type RepoId,
	type Result,
	type TerminalId,
	type WorkspaceId,
} from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Terminal } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	executeExisting,
	executeStatement,
	executeVoid,
	inTransaction,
	selectRows,
} from "./row-codec.ts";

export interface TerminalRow {
	id: TerminalId;
	workspace_id: WorkspaceId | null;
	repo_id: RepoId | null;
	kind: "terminal" | "setup" | "run" | "spotlight";
	title: string;
	cwd: string;
	host_kind: "local" | "cloud";
	start_command: string | null;
	screen_state: string | null;
	started_at: number;
	ended_at: number | null;
	exit_code: number | null;
}

export const terminalFromRow = (row: TerminalRow): Terminal => ({
	id: row.id,
	workspaceId: row.workspace_id,
	repoId: row.repo_id,
	kind: row.kind,
	title: row.title,
	cwd: row.cwd,
	hostKind: row.host_kind,
	startCommand: row.start_command,
	startedAt: row.started_at,
	endedAt: row.ended_at,
	exitCode: row.exit_code,
});

/** The model has no screen state; it is a column written at insert. */
export type TerminalInsert = Terminal & { screenState: string | null };

/** Parameters for TERMINALS_SQL.insert, in column order. */
export const terminalToParams = (terminal: TerminalInsert): readonly unknown[] => [
	terminal.id,
	terminal.workspaceId,
	terminal.repoId,
	terminal.kind,
	terminal.title,
	terminal.cwd,
	terminal.hostKind,
	terminal.startCommand,
	terminal.screenState,
	terminal.startedAt,
	terminal.endedAt,
	terminal.exitCode,
];

const COLUMNS = `id, workspace_id, repo_id, kind, title, cwd, host_kind, start_command,
	screen_state, started_at, ended_at, exit_code`;

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const TERMINALS_SQL = {
	listByWorkspace: `SELECT ${COLUMNS} FROM terminals WHERE workspace_id = $1
		ORDER BY started_at, id`,
	listByRepo: `SELECT ${COLUMNS} FROM terminals WHERE repo_id = $1 ORDER BY started_at, id`,
	get: `SELECT ${COLUMNS} FROM terminals WHERE id = $1`,
	insert: `INSERT INTO terminals (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
		$11, $12)`,
	getScreenState: "SELECT screen_state FROM terminals WHERE id = $1",
	setScreenState: "UPDATE terminals SET screen_state = $1 WHERE id = $2",
	markEnded:
		"UPDATE terminals SET ended_at = $1, exit_code = $2 WHERE id = $3 AND ended_at IS NULL",
	delete: "DELETE FROM terminals WHERE id = $1",
} as const;

/** What a caller supplies to record a new terminal. The repository adds id and start time. */
export type NewTerminal = Pick<
	Terminal,
	"workspaceId" | "repoId" | "kind" | "title" | "cwd" | "startCommand"
> & {
	/** Where it runs. Absent means the Mac, which is what rows before migration 0016 are. */
	hostKind?: "local" | "cloud";
};

export interface TerminalRepository {
	/** TERMINALS_SQL.listByWorkspace, oldest first. */
	listByWorkspace(workspaceId: WorkspaceId): Promise<Result<Terminal[]>>;
	/** TERMINALS_SQL.listByRepo: the repository terminal and its earlier runs. */
	listByRepo(repoId: RepoId): Promise<Result<Terminal[]>>;
	/** TERMINALS_SQL.get. A missing terminal is `ok(null)`. */
	get(id: TerminalId): Promise<Result<Terminal | null>>;
	/** TERMINALS_SQL.insert, with started_at from the clock and no end. */
	start(input: NewTerminal): Promise<Result<Terminal>>;
	/** TERMINALS_SQL.getScreenState: the saved JSON snapshot. `ok(null)` when none is saved. */
	getScreenState(id: TerminalId): Promise<Result<string | null>>;
	/** TERMINALS_SQL.setScreenState, written when a terminal ends or the app quits. */
	setScreenState(id: TerminalId, json: string | null): Promise<Result<void>>;
	/** TERMINALS_SQL.markEnded. `ok(false)` when it had already ended. */
	markEnded(id: TerminalId, endedAt: number, exitCode: number | null): Promise<Result<boolean>>;
	/**
	 * TERMINALS_SQL.delete, with the saved screen in the row. The Rust shell's scrollback file is not
	 * touched here.
	 */
	delete(id: TerminalId): Promise<Result<void>>;
}

export function createTerminalRepository(db: Database, deps: RepositoryDeps): TerminalRepository {
	const list = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<Terminal[]>> => {
		const rows = await selectRows<TerminalRow>(db, sql, params, what);
		return rows.ok ? ok(rows.value.map(terminalFromRow)) : err(rows.error);
	};
	return {
		listByWorkspace: (workspaceId) =>
			list(TERMINALS_SQL.listByWorkspace, [workspaceId], "Listing terminals"),
		listByRepo: (repoId) =>
			list(TERMINALS_SQL.listByRepo, [repoId], "Listing repository terminals"),
		get: async (id) => {
			const rows = await selectRows<TerminalRow>(db, TERMINALS_SQL.get, [id], "Reading a terminal");
			if (!rows.ok) return err(rows.error);
			const row = rows.value[0];
			return row === undefined ? ok(null) : ok(terminalFromRow(row));
		},
		start: async (input) =>
			inTransaction(db, "Starting a terminal", async (tx) => {
				const at = deps.clock.now();
				const terminal: TerminalInsert = {
					id: deps.ids.uuid() as TerminalId,
					workspaceId: input.workspaceId,
					repoId: input.repoId,
					kind: input.kind,
					title: input.title,
					cwd: input.cwd,
					hostKind: input.hostKind ?? "local",
					startCommand: input.startCommand,
					startedAt: at,
					endedAt: null,
					exitCode: null,
					screenState: null,
				};
				const written = await executeStatement(
					tx,
					TERMINALS_SQL.insert,
					terminalToParams(terminal),
					"Starting a terminal",
				);
				if (!written.ok) return err(written.error);
				return ok({
					id: terminal.id,
					workspaceId: terminal.workspaceId,
					repoId: terminal.repoId,
					kind: terminal.kind,
					title: terminal.title,
					cwd: terminal.cwd,
					hostKind: terminal.hostKind,
					startCommand: terminal.startCommand,
					startedAt: terminal.startedAt,
					endedAt: terminal.endedAt,
					exitCode: terminal.exitCode,
				});
			}),
		getScreenState: async (id) => {
			const rows = await selectRows<Pick<TerminalRow, "screen_state">>(
				db,
				TERMINALS_SQL.getScreenState,
				[id],
				"Reading a terminal's screen",
			);
			if (!rows.ok) return err(rows.error);
			return ok(rows.value[0]?.screen_state ?? null);
		},
		// A terminal removed before its screen was saved has no row; there is nothing to keep then.
		setScreenState: (id, json) =>
			executeVoid(db, TERMINALS_SQL.setScreenState, [json, id], "Saving a terminal's screen"),
		markEnded: async (id, endedAt, exitCode) => {
			const written = await executeStatement(
				db,
				TERMINALS_SQL.markEnded,
				[endedAt, exitCode, id],
				"Ending a terminal",
			);
			return written.ok ? ok(written.value > 0) : err(written.error);
		},
		delete: (id) => executeVoid(db, TERMINALS_SQL.delete, [id], "Removing a terminal"),
	};
}
