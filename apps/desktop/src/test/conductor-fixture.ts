/**
 * @feature test support A made-up Conductor database for the import's tests (APP-17)
 * Owns: `CONDUCTOR_FIXTURE_SCHEMA`, our own CREATE statements for the Conductor tables and columns
 * the import reads, and `buildConductorFixture`, which runs them on a real SQLite, inserts the
 * given rows and reads every table back, so the rows a test hands the import carry the column
 * defaults and types SQLite gives them. The result seeds the in-memory Platform's Conductor
 * database or the Node bindings' real file.
 * Behaviour: the column names and defaults follow Conductor's schema as the lead exported it
 * (table and column definitions only, no data); docs/research/conductor/services-map.md 2.2.
 * Must handle: a row naming a column the schema does not have fails, as SQLite does; a table
 * with no rows is still created, so it reads as an empty list and not as a missing table.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { MemoryConductorDatabase } from "../platform/memory.ts";

/** Our CREATE statements for the part of Conductor's schema the import reads. */
export const CONDUCTOR_FIXTURE_SCHEMA = `
CREATE TABLE repos (
	id TEXT PRIMARY KEY, remote_url TEXT, name TEXT, default_branch TEXT DEFAULT 'main',
	root_path TEXT, setup_script TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	storage_version INTEGER DEFAULT 1, archive_script TEXT, display_order INTEGER DEFAULT 0,
	run_script TEXT, run_script_mode TEXT DEFAULT 'concurrent', remote TEXT,
	conductor_config TEXT, icon TEXT, hidden INTEGER DEFAULT 0
);
CREATE TABLE workspaces (
	local_id TEXT PRIMARY KEY, repository_id TEXT, directory_name TEXT,
	active_session_id TEXT, branch TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	unread INTEGER DEFAULT 0, placeholder_branch_name TEXT, state TEXT DEFAULT 'active',
	initialization_parent_branch TEXT, setup_log_path TEXT, initialization_files_copied INTEGER,
	pinned_at TEXT, intended_target_branch TEXT, manual_status TEXT,
	derived_status TEXT DEFAULT 'in-progress', archive_commit TEXT, pr_title TEXT,
	pr_description TEXT, linked_directory_paths TEXT, hosting_server_url TEXT,
	workspace_path TEXT, user_set_workspace_name INTEGER DEFAULT 0,
	user_set_branch_name INTEGER DEFAULT 0, workspace_name TEXT, id TEXT, last_activity_at TEXT
);
CREATE TABLE sessions (
	id TEXT PRIMARY KEY, status TEXT DEFAULT 'idle', claude_session_id TEXT,
	unread_count INTEGER DEFAULT 0, context_token_count INTEGER DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	model TEXT, permission_mode TEXT DEFAULT 'default', last_user_message_at TEXT,
	workspace_id TEXT, is_hidden INTEGER DEFAULT 0, agent_type, title TEXT DEFAULT 'Untitled',
	codex_thinking_level TEXT, fast_mode INTEGER DEFAULT 0, agent_personality TEXT,
	claude_effort_level TEXT, queue_paused_at TEXT, remote_archived_at TEXT, acp_config TEXT
);
CREATE TABLE settings (
	key TEXT PRIMARY KEY, value TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')), deprecated_at TEXT
);
CREATE TABLE env_vars (key TEXT, scope TEXT, context TEXT, value TEXT);
CREATE TABLE navigation_sections (
	id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
	icon_name TEXT, sort_order INTEGER NOT NULL, created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL, emoji TEXT, kind TEXT
);
CREATE TABLE navigation_section_memberships (
	id TEXT PRIMARY KEY, section_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE TABLE favorite_models (
	organization_id TEXT, user_id TEXT, id TEXT, position INTEGER, configuration TEXT,
	created_at TEXT
);
CREATE TABLE diff_comments (
	id TEXT PRIMARY KEY, workspace_id TEXT, file_path TEXT, line_number INTEGER, body TEXT,
	state TEXT, location TEXT, created_at INTEGER NOT NULL, remote_url TEXT, author TEXT,
	thread_id TEXT, reply_to_comment_id TEXT, updated_at INTEGER, author_avatar_url TEXT,
	is_outdated INTEGER, is_resolved INTEGER, end_line_number INTEGER,
	suggestion_base_code TEXT, edited_at INTEGER
);
CREATE TABLE session_events (
	session_id TEXT, session_index INTEGER, event_id TEXT, event_type TEXT, content TEXT,
	received_at TEXT, reverted_at TEXT
);
CREATE TABLE session_messages (
	id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT, full_message TEXT,
	cancelled_at TEXT, turn_id TEXT
);
CREATE TABLE terminal_sessions (session_id TEXT PRIMARY KEY, workspace_id TEXT, cwd TEXT);
CREATE TABLE port_forwards (id TEXT PRIMARY KEY, workspace_id TEXT, remote_port INTEGER);
`;

export type ConductorFixtureRows = Partial<
	Record<string, readonly Readonly<Record<string, SQLInputValue>>[]>
>;

/** Runs the schema, inserts `rows` and reads every table back, as the copy's read would. */
export function buildConductorFixture(rows: ConductorFixtureRows): MemoryConductorDatabase {
	const db = new DatabaseSync(":memory:");
	try {
		db.exec(CONDUCTOR_FIXTURE_SCHEMA);
		for (const [table, tableRows] of Object.entries(rows)) {
			for (const row of tableRows ?? []) {
				const columns = Object.keys(row);
				db.prepare(
					`INSERT INTO "${table}" (${columns.map((name) => `"${name}"`).join(", ")})
					VALUES (${columns.map(() => "?").join(", ")})`,
				).run(...columns.map((name) => row[name] ?? null));
			}
		}
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((row) => String(row.name));
		return Object.fromEntries(
			tables.map((table) => [
				table,
				db
					.prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
					.all()
					.map((row) => ({ ...row })),
			]),
		);
	} finally {
		db.close();
	}
}
