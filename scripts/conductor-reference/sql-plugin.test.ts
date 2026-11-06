import { beforeAll, describe, expect, test } from "bun:test";
import { buildDatabase, openSqlPlugin } from "./sql-plugin.ts";
import { loadSqlJs, type SqlJsStatic } from "./sqljs-types.ts";

let SQL: SqlJsStatic;
beforeAll(async () => {
	SQL = await loadSqlJs();
});

const SCHEMA = `
CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT, pinned INTEGER DEFAULT 0, meta TEXT, raw BLOB);
CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER);
`;

const plugin = () =>
	openSqlPlugin(SQL, [
		{
			name: "sqlite:notes.db",
			bytes: buildDatabase(SQL, {
				name: "sqlite:notes.db",
				schema: SCHEMA,
				rows: { notes: [{ id: "a", body: "first", meta: { tags: ["x"] } }] },
				setup: ["INSERT INTO counter (id, value) VALUES (1, 0)"],
			}),
		},
	]);

describe("the SQL plugin over sql.js", () => {
	test("load answers with the database name, and an unknown name is an error", () => {
		const sql = plugin();
		expect(sql.call("plugin:sql|load", { db: "sqlite:notes.db" })).toEqual({
			ok: true,
			value: "sqlite:notes.db",
		});
		expect(sql.call("plugin:sql|load", { db: "sqlite:other.db" }).ok).toBe(false);
		sql.close();
	});

	test("select returns seeded rows, with objects stored as JSON text", () => {
		const sql = plugin();
		const answer = sql.call("plugin:sql|select", {
			db: "sqlite:notes.db",
			query: "SELECT id, body, pinned, meta FROM notes WHERE id = ?",
			values: ["a"],
		});
		expect(answer).toEqual({
			ok: true,
			value: [{ id: "a", body: "first", pinned: 0, meta: '{"tags":["x"]}' }],
		});
		sql.close();
	});

	test("execute answers [rowsAffected, lastInsertId] and binds booleans and $n names", () => {
		const sql = plugin();
		const inserted = sql.call("plugin:sql|execute", {
			db: "sqlite:notes.db",
			query: "INSERT INTO notes (id, body, pinned) VALUES ($1, $2, $3)",
			values: ["b", "second", true],
		});
		expect(inserted).toEqual({ ok: true, value: [1, 2] });
		const pinned = sql.call("plugin:sql|select", {
			db: "sqlite:notes.db",
			query: "SELECT pinned FROM notes WHERE id = 'b'",
		});
		expect(pinned).toEqual({ ok: true, value: [{ pinned: 1 }] });
		sql.close();
	});

	test("each opened plugin has its own copy of the database", () => {
		const first = plugin();
		const second = plugin();
		first.call("plugin:sql|execute", {
			db: "sqlite:notes.db",
			query: "DELETE FROM notes",
		});
		const left = second.call("plugin:sql|select", {
			db: "sqlite:notes.db",
			query: "SELECT count(*) AS n FROM notes",
		});
		expect(left).toEqual({ ok: true, value: [{ n: 1 }] });
		first.close();
		second.close();
	});

	test("a failing statement answers with SQLite's message", () => {
		const sql = plugin();
		const answer = sql.call("plugin:sql|select", {
			db: "sqlite:notes.db",
			query: "SELECT missing FROM notes",
		});
		expect(answer).toEqual({ ok: false, error: "no such column: missing" });
		sql.close();
	});

	test("a seed row for a column the schema lacks fails with the table named", () => {
		expect(() =>
			buildDatabase(SQL, { name: "sqlite:x.db", schema: SCHEMA, rows: { notes: [{ nope: 1 }] } }),
		).toThrow("Seeding sqlite:x.db table notes failed: table notes has no column named nope");
	});
});
