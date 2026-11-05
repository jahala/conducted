/**
 * Guard: every table states its lifetime, and docs/data-model.md lists the tables the migrations
 * create. The table in the doc is generated from the migrations; `--write` regenerates it.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Problem, read } from "./lib.ts";

export const MIGRATIONS_DIR = "apps/desktop/src-tauri/migrations";
export const DOC = "docs/data-model.md";
const START = "<!-- generated:tables -->";
const END = "<!-- /generated:tables -->";

export interface TableInfo {
	name: string;
	migration: string;
	summary: string;
	lifetime: string | null;
}

/** Reads each CREATE TABLE and the comment block right above it. */
export function parseTables(sql: string, migration: string): TableInfo[] {
	const lines = sql.split("\n");
	const tables: TableInfo[] = [];
	lines.forEach((line, index) => {
		const match = /^CREATE TABLE (\w+)/.exec(line);
		if (!match?.[1]) return;
		const comment: string[] = [];
		for (let i = index - 1; i >= 0 && lines[i]?.startsWith("--"); i--) {
			comment.unshift((lines[i] ?? "").replace(/^--\s?/, ""));
		}
		const text = comment.join(" ").replace(/\s+/g, " ").trim();
		const at = text.indexOf("Lifetime:");
		tables.push({
			name: match[1],
			migration,
			summary: (at === -1 ? text : text.slice(0, at)).trim(),
			lifetime: at === -1 ? null : text.slice(at + "Lifetime:".length).trim(),
		});
	});
	return tables;
}

/** Every table once: a table rebuilt by a later migration shows its latest definition. */
export function readTables(root: string): TableInfo[] {
	const dir = join(root, MIGRATIONS_DIR);
	const latest = new Map<string, TableInfo>();
	const order: string[] = [];
	for (const name of readdirSync(dir)
		.filter((n) => n.endsWith(".sql"))
		.sort()) {
		for (const table of parseTables(read(join(dir, name)), name)) {
			const earlier = latest.get(table.name);
			if (!earlier) order.push(table.name);
			latest.set(
				table.name,
				earlier
					? { ...table, migration: `${earlier.migration.split(",")[0]}, rebuilt in ${name}` }
					: table,
			);
		}
	}
	return order.map((name) => latest.get(name) as TableInfo);
}

export function renderTables(tables: TableInfo[]): string {
	const rows = tables.map(
		(t) => `| \`${t.name}\` | ${t.summary} | ${t.lifetime ?? "(missing)"} | ${t.migration} |`,
	);
	return [
		START,
		"| Table | Holds | Lifetime | Created in |",
		"|---|---|---|---|",
		...rows,
		END,
	].join("\n");
}

function generatedBlock(doc: string): string | null {
	const start = doc.indexOf(START);
	const end = doc.indexOf(END);
	return start === -1 || end === -1 ? null : doc.slice(start, end + END.length);
}

export function checkDataModel(root: string): Problem[] {
	const tables = readTables(root);
	const problems: Problem[] = tables
		.filter((t) => t.lifetime === null)
		.map((t) => ({
			guard: "data-model",
			message: `table ${t.name} (${t.migration}) has no "Lifetime:" in its comment`,
		}));
	const block = generatedBlock(read(join(root, DOC)));
	if (block === null) {
		problems.push({ guard: "data-model", message: `${DOC} has no generated table markers` });
	} else if (block.replace(/\s+/g, " ") !== renderTables(tables).replace(/\s+/g, " ")) {
		problems.push({
			guard: "data-model",
			message: `${DOC} is out of date with the migrations: run bun scripts/guards/data-model.ts --write`,
		});
	}
	return problems;
}

if (import.meta.main && process.argv.includes("--write")) {
	const root = join(import.meta.dir, "../..");
	const path = join(root, DOC);
	const doc = read(path);
	const block = generatedBlock(doc);
	if (block === null) throw new Error(`${DOC} has no generated table markers`);
	writeFileSync(path, doc.replace(block, renderTables(readTables(root))));
	console.log(`Updated ${DOC}`);
}
