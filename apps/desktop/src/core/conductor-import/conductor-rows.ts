/**
 * @feature APP-17 Conductor's rows, as the import reads them
 * Owns: the shapes of the Conductor rows the import maps (`ConductorRows`), `parseConductorRows`,
 * which checks each row of a snapshot on its own, and `conductorTime`, which reads Conductor's time
 * values as milliseconds.
 * Behaviour: docs/research/conductor/services-map.md 2.2 (tables and columns), 2.4 (states) and
 * 4.2.8 (env_vars). Conductor writes text times with `datetime('now')` ("2026-01-02 03:04:05",
 * UTC) and with `strftime('%Y-%m-%dT%H:%M:%fZ')`; `diff_comments` keeps integer times.
 * Must handle: a table Conductor's schema does not have reads as no rows; a row whose id or
 * required column is missing or of the wrong type is left out on its own, with its table named,
 * and never stops the other rows; a text time without a zone is UTC; an integer time below 1e11
 * is in seconds, at or above it in milliseconds; any other value is no time.
 * Test first: conductorTime reads 2026-01-02 03:04:05 as that moment in UTC.
 */

import { z } from "zod";
import type { ConductorSnapshot } from "../../platform/platform.ts";

const text = z.string();
const optionalText = z
	.string()
	.nullish()
	.transform((value) => value ?? null);
const optionalNumber = z
	.number()
	.nullish()
	.transform((value) => value ?? null);
const flag = z
	.number()
	.nullish()
	.transform((value) => value !== null && value !== undefined && value !== 0);
const time = z
	.union([z.string(), z.number()])
	.nullish()
	.transform((value) => value ?? null);

export const zConductorRepo = z.object({
	id: text,
	name: optionalText,
	remote_url: optionalText,
	default_branch: optionalText,
	root_path: optionalText,
	display_order: optionalNumber,
	hidden: flag,
	icon: optionalText,
	setup_script: optionalText,
	run_script: optionalText,
	archive_script: optionalText,
	run_script_mode: optionalText,
	conductor_config: optionalText,
	created_at: time,
	updated_at: time,
});

export const zConductorWorkspace = z.object({
	local_id: text,
	repository_id: optionalText,
	directory_name: optionalText,
	branch: optionalText,
	state: optionalText,
	unread: flag,
	intended_target_branch: optionalText,
	derived_status: optionalText,
	manual_status: optionalText,
	pinned_at: time,
	workspace_name: optionalText,
	user_set_workspace_name: flag,
	linked_directory_paths: optionalText,
	workspace_path: optionalText,
	hosting_server_url: optionalText,
	active_session_id: optionalText,
	pr_title: optionalText,
	pr_description: optionalText,
	archive_commit: optionalText,
	initialization_files_copied: optionalNumber,
	created_at: time,
	updated_at: time,
	last_activity_at: time,
});

export const zConductorSession = z.object({
	id: text,
	workspace_id: optionalText,
	claude_session_id: optionalText,
	agent_type: optionalText,
	model: optionalText,
	permission_mode: optionalText,
	claude_effort_level: optionalText,
	codex_thinking_level: optionalText,
	agent_personality: optionalText,
	fast_mode: flag,
	title: optionalText,
	is_hidden: flag,
	unread_count: optionalNumber,
	context_token_count: optionalNumber,
	last_user_message_at: time,
	queue_paused_at: time,
	remote_archived_at: time,
	created_at: time,
	updated_at: time,
});

export const zConductorSetting = z.object({
	key: text,
	value: optionalText,
	deprecated_at: optionalText,
});

export const zConductorEnvVar = z.object({
	key: text,
	scope: optionalText,
	context: optionalText,
	has_value: z.boolean(),
});

export const zConductorSection = z.object({
	id: text,
	organization_id: optionalText,
	user_id: optionalText,
	name: text,
	emoji: optionalText,
	sort_order: optionalNumber,
	created_at: time,
});

export const zConductorMembership = z.object({
	id: optionalText,
	section_id: text,
	workspace_id: text,
	created_at: time,
});

export const zConductorFavorite = z.object({
	id: text,
	position: optionalNumber,
	configuration: optionalText,
});

export const zConductorComment = z.object({
	id: text,
	workspace_id: optionalText,
	file_path: optionalText,
	line_number: optionalNumber,
	end_line_number: optionalNumber,
	body: optionalText,
	state: optionalText,
	location: optionalText,
	author: optionalText,
	author_avatar_url: optionalText,
	remote_url: optionalText,
	thread_id: optionalText,
	reply_to_comment_id: optionalText,
	is_outdated: flag,
	is_resolved: flag,
	suggestion_base_code: optionalText,
	created_at: time,
	updated_at: time,
});

const SCHEMAS = {
	repos: zConductorRepo,
	workspaces: zConductorWorkspace,
	sessions: zConductorSession,
	settings: zConductorSetting,
	env_vars: zConductorEnvVar,
	navigation_sections: zConductorSection,
	navigation_section_memberships: zConductorMembership,
	favorite_models: zConductorFavorite,
	diff_comments: zConductorComment,
} as const;

type Schemas = typeof SCHEMAS;
export type ConductorTable = keyof Schemas;

export type ConductorRows = { [Table in ConductorTable]: z.infer<Schemas[Table]>[] };
export type ConductorRepo = z.infer<typeof zConductorRepo>;
export type ConductorWorkspace = z.infer<typeof zConductorWorkspace>;
export type ConductorSession = z.infer<typeof zConductorSession>;
export type ConductorEnvVar = z.infer<typeof zConductorEnvVar>;
export type ConductorComment = z.infer<typeof zConductorComment>;

/** Rows of one table that could not be read, by table. */
export type UnreadableRows = Partial<Record<ConductorTable, number>>;

/** Checks each row on its own. Rows that fail are counted per table and left out. */
export function parseConductorRows(snapshot: ConductorSnapshot): {
	rows: ConductorRows;
	unreadable: UnreadableRows;
} {
	const unreadable: UnreadableRows = {};
	const parseTable = <Table extends ConductorTable>(table: Table): ConductorRows[Table] => {
		const schema = SCHEMAS[table];
		const parsed: unknown[] = [];
		for (const row of snapshot.tables[table] ?? []) {
			const checked = schema.safeParse(row);
			if (checked.success) parsed.push(checked.data);
			else unreadable[table] = (unreadable[table] ?? 0) + 1;
		}
		return parsed as ConductorRows[Table];
	};
	return {
		rows: {
			repos: parseTable("repos"),
			workspaces: parseTable("workspaces"),
			sessions: parseTable("sessions"),
			settings: parseTable("settings"),
			env_vars: parseTable("env_vars"),
			navigation_sections: parseTable("navigation_sections"),
			navigation_section_memberships: parseTable("navigation_section_memberships"),
			favorite_models: parseTable("favorite_models"),
			diff_comments: parseTable("diff_comments"),
		},
		unreadable,
	};
}

const TEXT_TIME =
	/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/;

/** Below this an integer time is in seconds: 1e11 milliseconds is March 1973. */
const SECONDS_BELOW = 1e11;

/** A Conductor time as milliseconds since the epoch, or null when the value is no time. */
export function conductorTime(value: string | number | null): number | null {
	if (value === null) return null;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || value <= 0) return null;
		return value < SECONDS_BELOW ? Math.round(value * 1000) : Math.round(value);
	}
	const match = TEXT_TIME.exec(value.trim());
	if (match === null) return null;
	const [, day, clock, zone] = match;
	const zoned =
		zone === undefined ? "Z" : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
	const parsed = Date.parse(`${day}T${clock}${zoned}`);
	return Number.isNaN(parsed) ? null : parsed;
}
