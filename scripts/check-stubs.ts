/**
 * Compares the placeholders in the code with docs/plans/backlog.md.
 *
 * Fails when:
 *  - the backlog has a row it cannot read, or a row needs an id the backlog does not list, or
 *  - code names a feature id that the backlog does not list (a stub nobody tracks), or
 *  - a backlog row marked `stub` has no placeholder left in the code (work silently dropped), or
 *  - a backlog row marked `done` still has placeholders (the row lies).
 * A `planned` row may have placeholders or none: its work has not started.
 *
 * Usage: bun scripts/check-stubs.ts [--list]
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isTestFile, placeholdersIn, walk } from "./guards/lib.ts";
import { type BacklogRow, scanBacklog } from "./issues/model.ts";

const ROOT = join(import.meta.dir, "..");
const SCAN = ["apps", "packages", "bin"];

/** Placeholder ids and the files that hold them. */
export type Found = Map<string, string[]>;

/** Every problem between the backlog's rows and the placeholders found in the code. */
export function stubProblems(
	rows: BacklogRow[],
	found: Found,
	backlogProblems: string[],
): string[] {
	const problems = [...backlogProblems];
	const status = new Map(rows.map((row) => [row.id, row.status]));
	for (const row of rows) {
		for (const need of row.needs) {
			if (!status.has(need)) problems.push(`${row.id} needs ${need}, which is not in the backlog`);
		}
	}
	for (const [id, where] of found) {
		const state = status.get(id);
		if (state === undefined)
			problems.push(`${id} is used in ${where[0]} but missing from the backlog`);
		if (state === "done")
			problems.push(`${id} is marked done but still has placeholders: ${where.join(", ")}`);
	}
	for (const [id, state] of status) {
		if (state === "stub" && !found.has(id))
			problems.push(`${id} is marked stub but no placeholder exists in the code`);
	}
	return problems;
}

/** Reads every source file under the scanned folders and collects its placeholders. */
export function findPlaceholders(root: string): Found {
	const found: Found = new Map();
	for (const top of SCAN) {
		for (const path of walk(root, join(root, top), /\.(ts|tsx|rs|sh)$/)) {
			if (isTestFile(path)) continue;
			for (const id of placeholdersIn(readFileSync(path, "utf8"))) {
				found.set(id, [...(found.get(id) ?? []), relative(root, path)]);
			}
		}
	}
	return found;
}

if (import.meta.main) {
	const scan = scanBacklog(readFileSync(join(ROOT, "docs/plans/backlog.md"), "utf8"));
	const found = findPlaceholders(ROOT);
	const problems = stubProblems(scan.rows, found, scan.problems);

	const open = scan.rows.filter((row) => row.status === "stub").length;
	const done = scan.rows.filter((row) => row.status === "done").length;
	const placeholders = [...found.values()].reduce((sum, where) => sum + where.length, 0);
	console.log(
		`Backlog: ${scan.rows.length} features, ${done} done, ${open} open. Placeholders in code: ${placeholders}.`,
	);

	if (process.argv.includes("--list")) {
		for (const [id, where] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
			console.log(`  ${id}  ${[...new Set(where)].join(", ")}`);
		}
	}

	if (problems.length > 0) {
		console.error(`\n${problems.length} problem(s):`);
		for (const problem of problems) console.error(`  - ${problem}`);
		process.exit(1);
	}
}
