/**
 * The reference run's check without a browser. For every catalogue state it seeds our sample data,
 * builds the mapped databases and the route, then runs the frontend's own SQL against them; and it says
 * how much of the call inventory the stand-in answers.
 *
 * - SQL: every statement in the inventory whose full text is known (no `${...}` part) is prepared on the
 *   mapped databases; a statement neither database can prepare is listed. Statements without
 *   placeholders are also run, so the counts show what the frontend's own queries find in our rows.
 * - Answers: a call counts as answered when the backend has it built in (the SQL and event plugins, the
 *   tunnel), the page keeps it (event `listen` and `unlisten`), or the mapping has a handler. A sidecar
 *   method counts when the mapping has a handler.
 *
 * Usage: bun scripts/conductor-reference/check.ts [--mapping <file>] [--inventory <file>] [--out <file>]
 * Writes the details as JSON (default: `check.json` beside the mapping) and prints a summary.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReferenceMapping } from "./backend.ts";
import { loadCatalogue, type SeededState } from "./catalogue.ts";
import type { Inventory } from "./inventory.ts";
import { defaultPaths } from "./paths.ts";
import { flag, loadMapping } from "./server.ts";
import { buildDatabase } from "./sql-plugin.ts";
import { loadSqlJs, type SqlJsStatic } from "./sqljs-types.ts";

/** Calls the backend or the page answers whatever the mapping holds. */
const BUILT_IN = new Set([
	"plugin:sql|load",
	"plugin:sql|execute",
	"plugin:sql|select",
	"plugin:sql|close",
	"plugin:event|emit",
	"plugin:event|emit_to",
	"plugin:event|listen",
	"plugin:event|unlisten",
]);

export interface Coverage {
	commands: { total: number; answered: string[]; unanswered: string[] };
	plugins: { total: number; answered: string[]; unanswered: string[] };
	sidecar: { total: number; answered: string[]; unanswered: string[] };
}

export function coverage(inventory: Inventory, mapping: ReferenceMapping<SeededState>): Coverage {
	const answers = (name: string): boolean =>
		BUILT_IN.has(name) || name === mapping.tunnel?.command || name in mapping.commands;
	const split = (names: string[], answered: (name: string) => boolean) => ({
		total: names.length,
		answered: names.filter(answered),
		unanswered: names.filter((name) => !answered(name)),
	});
	const plugins = Object.entries(inventory.plugins).flatMap(([plugin, entries]) =>
		entries.map((entry) => `plugin:${plugin}|${entry.name}`),
	);
	const sent = [
		...new Set(
			inventory.sidecar
				.filter((entry) => entry.direction === "to-sidecar")
				.map((entry) => entry.method),
		),
	];
	return {
		commands: split(
			inventory.commands.map((entry) => entry.name),
			answers,
		),
		plugins: split(plugins, answers),
		sidecar: split(sent, (method) => method in mapping.sidecar),
	};
}

interface StateCheck {
	id: string;
	route: string | null;
	error: string | null;
	/** Rows in each mapped table, by database. */
	rows: Record<string, Record<string, number>>;
	/** Rows each placeholder-free SELECT of the frontend returns, for those that return any. */
	selects: Record<string, number>;
}

function checkState(
	SQL: SqlJsStatic,
	seeded: SeededState,
	mapping: ReferenceMapping<SeededState>,
	selects: string[],
): StateCheck {
	const check: StateCheck = { id: seeded.id, route: null, error: null, rows: {}, selects: {} };
	try {
		check.route = mapping.route(seeded);
		for (const seed of mapping.databases(seeded)) {
			check.rows[seed.name] = Object.fromEntries(
				Object.entries(seed.rows ?? {}).map(([table, rows]) => [table, rows.length]),
			);
			const db = new SQL.Database(buildDatabase(SQL, seed));
			try {
				for (const statement of selects) {
					try {
						const found = db.exec(statement)[0]?.values.length ?? 0;
						if (found > 0) check.selects[statement] = (check.selects[statement] ?? 0) + found;
					} catch {
						// A statement for the other database; preparing is checked once, below.
					}
				}
			} finally {
				db.close();
			}
		}
	} catch (cause) {
		check.error = cause instanceof Error ? cause.message : String(cause);
	}
	return check;
}

async function main(args: string[]): Promise<number> {
	const paths = defaultPaths();
	const mappingPath = flag(args, "mapping") ?? paths.mapping;
	const inventory = JSON.parse(
		readFileSync(flag(args, "inventory") ?? paths.inventory, "utf8"),
	) as Inventory;
	const out = flag(args, "out") ?? join(dirname(mappingPath), "check.json");
	const SQL = await loadSqlJs();
	const mapping = await loadMapping(mappingPath);
	const catalogue = await loadCatalogue();

	const known = inventory.sql.filter((entry) => !entry.dynamic).map((entry) => entry.statement);
	const selects = known.filter(
		(statement) => /^SELECT\b/i.test(statement) && !/\?|\$\d/.test(statement),
	);
	const states: StateCheck[] = [];
	for (const state of catalogue.states) {
		states.push(checkState(SQL, await catalogue.seed(state.id), mapping, selects));
	}

	// Prepare every known statement on the first state's databases (the schema is the same for all).
	const first = await catalogue.seed(catalogue.states[0]?.id ?? "");
	const dbs = mapping.databases(first).map((seed) => new SQL.Database(buildDatabase(SQL, seed)));
	const unprepared: { statement: string; error: string }[] = [];
	for (const statement of known) {
		const errors: string[] = [];
		for (const db of dbs) {
			try {
				db.prepare(statement).free();
				errors.length = 0;
				break;
			} catch (cause) {
				errors.push(cause instanceof Error ? cause.message : String(cause));
			}
		}
		if (errors.length > 0) unprepared.push({ statement, error: errors[0] ?? "" });
	}
	for (const db of dbs) db.close();

	const answered = coverage(inventory, mapping);
	writeFileSync(
		out,
		`${JSON.stringify({ coverage: answered, sql: { known: known.length, unprepared }, states }, null, "\t")}\n`,
	);
	const failed = states.filter((state) => state.error !== null);
	const routed = states.filter((state) => state.route !== null);
	console.log(
		`states: ${states.length}, with a Conductor route: ${routed.length}, failed: ${failed.length}`,
	);
	for (const state of failed) console.log(`FAIL ${state.id}: ${state.error}`);
	console.log(
		`SQL: ${known.length - unprepared.length} of ${known.length} known statements prepare on the mapped schema`,
	);
	for (const kind of ["commands", "plugins", "sidecar"] as const) {
		const part = answered[kind];
		console.log(`${kind}: ${part.answered.length} of ${part.total} answered`);
	}
	console.log(`Written to ${out}`);
	return failed.length === 0 ? 0 : 1;
}

if (import.meta.main) {
	main(process.argv.slice(2))
		.then((code) => process.exit(code))
		.catch((cause: unknown) => {
			console.error(cause instanceof Error ? cause.message : cause);
			process.exit(1);
		});
}
