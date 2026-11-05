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
import { notImplemented, type Result, type SnippetId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Snippet } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";

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

export function createSnippetRepository(_db: Database, _deps: RepositoryDeps): SnippetRepository {
	return {
		list: async () => notImplemented("DATA-08"),
		get: async () => notImplemented("DATA-08"),
		getByKeyword: async () => notImplemented("DATA-08"),
		create: async () => notImplemented("DATA-08"),
		update: async () => notImplemented("DATA-08"),
		delete: async () => notImplemented("DATA-08"),
	};
}
