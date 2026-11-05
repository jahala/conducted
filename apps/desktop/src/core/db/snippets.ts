/**
 * @feature DATA-08 Repository for the snippets table
 * Owns: every read and write of the user's prompt snippets (a name, an optional keyword and the
 * prompt text), private to this Mac.
 * Behaviour: migration 0004; ui-map.md for the snippet picker and the keyword trigger (COMP-09).
 * Our design choice: snippets are not shared or synced (D025).
 * Must handle: a duplicate keyword (UNIQUE) returns the error code `db.conflict` instead of
 * throwing; a null keyword may repeat, because SQLite treats NULLs as different; a keyword is
 * stored as given, so the caller trims it; every update sets `updated_at`.
 * Test first: two snippets with the same keyword cannot both be inserted, and two with no
 * keyword can.
 */
import { err, ok, type Result, type SnippetId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Snippet } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import { executeExisting, executeStatement, executeVoid, selectRows } from "./row-codec.ts";

export interface SnippetRow {
	id: SnippetId;
	name: string;
	keyword: string | null;
	prompt: string;
	created_at: number;
	updated_at: number;
}

export const snippetFromRow = (row: SnippetRow): Snippet => ({
	id: row.id,
	name: row.name,
	keyword: row.keyword,
	prompt: row.prompt,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

/** Parameters for SNIPPETS_SQL.insert, in column order. */
export const snippetToParams = (snippet: Snippet): readonly unknown[] => [
	snippet.id,
	snippet.name,
	snippet.keyword,
	snippet.prompt,
	snippet.createdAt,
	snippet.updatedAt,
];

const COLUMNS = "id, name, keyword, prompt, created_at, updated_at";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const SNIPPETS_SQL = {
	list: `SELECT ${COLUMNS} FROM snippets ORDER BY name COLLATE NOCASE, id`,
	get: `SELECT ${COLUMNS} FROM snippets WHERE id = $1`,
	getByKeyword: `SELECT ${COLUMNS} FROM snippets WHERE keyword = $1`,
	insert: `INSERT INTO snippets (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`,
	update: "UPDATE snippets SET name = $1, keyword = $2, prompt = $3, updated_at = $4 WHERE id = $5",
	delete: "DELETE FROM snippets WHERE id = $1",
} as const;

/** What a caller supplies to add or change a snippet. The repository adds id and times. */
export type SnippetFields = Pick<Snippet, "name" | "keyword" | "prompt">;

export interface SnippetRepository {
	/** SNIPPETS_SQL.list: by name, ignoring case. */
	list(): Promise<Result<Snippet[]>>;
	/** SNIPPETS_SQL.get. A missing snippet is `ok(null)`. */
	get(id: SnippetId): Promise<Result<Snippet | null>>;
	/** SNIPPETS_SQL.getByKeyword. Used to expand a typed keyword. A missing one is `ok(null)`. */
	getByKeyword(keyword: string): Promise<Result<Snippet | null>>;
	/** SNIPPETS_SQL.insert with a new id and both times. A duplicate keyword is `db.conflict`. */
	create(input: SnippetFields): Promise<Result<Snippet>>;
	/** SNIPPETS_SQL.update. A missing snippet is `db.not_found`; a duplicate keyword `db.conflict`. */
	update(id: SnippetId, input: SnippetFields): Promise<Result<void>>;
	/** SNIPPETS_SQL.delete. */
	delete(id: SnippetId): Promise<Result<void>>;
}

export function createSnippetRepository(db: Database, deps: RepositoryDeps): SnippetRepository {
	const now = (): number => deps.clock.now();
	const list = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<Snippet[]>> => {
		const rows = await selectRows<SnippetRow>(db, sql, params, what);
		return rows.ok ? ok(rows.value.map(snippetFromRow)) : err(rows.error);
	};
	const find = async (
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<Snippet | null>> => {
		const rows = await selectRows<SnippetRow>(db, sql, params, what);
		if (!rows.ok) return err(rows.error);
		const row = rows.value[0];
		return ok(row === undefined ? null : snippetFromRow(row));
	};
	return {
		list: () => list(SNIPPETS_SQL.list, [], "Listing snippets"),
		get: (id) => find(SNIPPETS_SQL.get, [id], "Reading a snippet"),
		getByKeyword: (keyword) =>
			find(SNIPPETS_SQL.getByKeyword, [keyword], "Reading a snippet by keyword"),
		create: async (input) => {
			const at = now();
			const snippet: Snippet = {
				id: deps.ids.uuid() as SnippetId,
				name: input.name,
				keyword: input.keyword,
				prompt: input.prompt,
				createdAt: at,
				updatedAt: at,
			};
			const written = await executeStatement(
				db,
				SNIPPETS_SQL.insert,
				snippetToParams(snippet),
				"Creating a snippet",
			);
			return written.ok ? ok(snippet) : err(written.error);
		},
		update: (id, input) =>
			executeExisting(
				db,
				SNIPPETS_SQL.update,
				[input.name, input.keyword, input.prompt, now(), id],
				"Updating a snippet",
			),
		delete: (id) => executeVoid(db, SNIPPETS_SQL.delete, [id], "Removing a snippet"),
	};
}
