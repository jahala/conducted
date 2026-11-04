/**
 * @feature DATA-01 Repository for the terminals table
 * Owns: terminal tabs and script runs (setup, run, spotlight) of a workspace. Scrollback files
 * are written by the Rust shell and not touched here.
 * Behaviour: services-map.md 2.3.5 (terminal_sessions: upsert, delete) and 5A (terminals).
 * Must handle: marking ended is compare-and-set on ended_at IS NULL, so the first exit report
 * wins; a crash leaves rows with ended_at NULL, which startup repair closes (repair.ts); ended
 * terminals older than 14 days are removed with their files by the lifetime job (lifetime.ts).
 * Test first: markEnded twice keeps the first exit code.
 */
import { notImplemented, type Result, type TerminalId, type WorkspaceId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Terminal } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";

export interface TerminalRow {
	id: TerminalId;
	workspace_id: WorkspaceId;
	kind: "terminal" | "setup" | "run" | "spotlight";
	title: string;
	cwd: string;
	cols: number;
	rows: number;
	started_at: number;
	ended_at: number | null;
	exit_code: number | null;
}

export const terminalFromRow = (row: TerminalRow): Terminal => ({
	id: row.id,
	workspaceId: row.workspace_id,
	kind: row.kind,
	title: row.title,
	cwd: row.cwd,
	startedAt: row.started_at,
	endedAt: row.ended_at,
	exitCode: row.exit_code,
});

/** The model has no size, both numbers are columns written at insert. */
export type TerminalInsert = Terminal & { cols: number; rows: number };

/** Parameters for TERMINALS_SQL.insert, in column order. */
export const terminalToParams = (terminal: TerminalInsert): readonly unknown[] => [
	terminal.id,
	terminal.workspaceId,
	terminal.kind,
	terminal.title,
	terminal.cwd,
	terminal.cols,
	terminal.rows,
	terminal.startedAt,
	terminal.endedAt,
	terminal.exitCode,
];

const COLUMNS = "id, workspace_id, kind, title, cwd, cols, rows, started_at, ended_at, exit_code";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const TERMINALS_SQL = {
	listByWorkspace: `SELECT ${COLUMNS} FROM terminals WHERE workspace_id = $1
		ORDER BY started_at, id`,
	listActive: `SELECT ${COLUMNS} FROM terminals WHERE ended_at IS NULL ORDER BY started_at, id`,
	get: `SELECT ${COLUMNS} FROM terminals WHERE id = $1`,
	insert: `INSERT INTO terminals (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
	setTitle: "UPDATE terminals SET title = $1 WHERE id = $2",
	setSize: "UPDATE terminals SET cols = $1, rows = $2 WHERE id = $3",
	markEnded:
		"UPDATE terminals SET ended_at = $1, exit_code = $2 WHERE id = $3 AND ended_at IS NULL",
	delete: "DELETE FROM terminals WHERE id = $1",
} as const;

/** What a caller supplies to record a new terminal. The repository adds id and start time. */
export type NewTerminal = Pick<Terminal, "workspaceId" | "kind" | "title" | "cwd"> & {
	cols: number;
	rows: number;
};

export interface TerminalRepository {
	/** TERMINALS_SQL.listByWorkspace, oldest first. */
	listByWorkspace(workspaceId: WorkspaceId): Promise<Result<Terminal[]>>;
	/** TERMINALS_SQL.listActive: terminals with no end time. */
	listActive(): Promise<Result<Terminal[]>>;
	/** TERMINALS_SQL.get. A missing terminal is `ok(null)`. */
	get(id: TerminalId): Promise<Result<Terminal | null>>;
	/** TERMINALS_SQL.insert, with started_at from the clock and no end. */
	start(input: NewTerminal): Promise<Result<Terminal>>;
	/** TERMINALS_SQL.setTitle. */
	setTitle(id: TerminalId, title: string): Promise<Result<void>>;
	/** TERMINALS_SQL.setSize. */
	setSize(id: TerminalId, cols: number, rows: number): Promise<Result<void>>;
	/** TERMINALS_SQL.markEnded. `ok(false)` when it had already ended. */
	markEnded(id: TerminalId, endedAt: number, exitCode: number | null): Promise<Result<boolean>>;
	/** TERMINALS_SQL.delete. The caller trashes the scrollback file. */
	delete(id: TerminalId): Promise<Result<void>>;
}

export function createTerminalRepository(_db: Database, _deps: RepositoryDeps): TerminalRepository {
	return {
		listByWorkspace: async () => notImplemented("DATA-01"),
		listActive: async () => notImplemented("DATA-01"),
		get: async () => notImplemented("DATA-01"),
		start: async () => notImplemented("DATA-01"),
		setTitle: async () => notImplemented("DATA-01"),
		setSize: async () => notImplemented("DATA-01"),
		markEnded: async () => notImplemented("DATA-01"),
		delete: async () => notImplemented("DATA-01"),
	};
}
