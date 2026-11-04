/**
 * Compares the placeholders in the code with docs/plans/backlog.md.
 *
 * Fails when:
 *  - code names a feature id that the backlog does not list (a stub nobody tracks), or
 *  - a backlog row marked `stub` has no placeholder left in the code (work silently dropped), or
 *  - a backlog row marked `done` still has placeholders (the row lies).
 *
 * Usage: bun scripts/check-stubs.ts [--list]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCAN = ["apps", "packages", "bin"];
const SKIP = new Set(["node_modules", "dist", "target", "gen", ".vite"]);
const EXTENSIONS = /\.(ts|tsx|rs|sh)$/;
// notImplemented("<ID>") | not_implemented!("<ID>") | not_implemented "<ID>"
const PLACEHOLDER = /not_?[iI]mplemented!?\s*\(?\s*"([A-Z]+-\d{2})"/g;
const ROW = /^\|\s*([A-Z]+-\d{2})\s*\|.*\|\s*(stub|done)\s*\|\s*$/;

function* files(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* files(path);
		else if (EXTENSIONS.test(name) && !name.endsWith(".test.ts")) yield path;
	}
}

const backlog = new Map<string, "stub" | "done">();
for (const line of readFileSync(join(ROOT, "docs/plans/backlog.md"), "utf8").split("\n")) {
	const match = ROW.exec(line);
	if (match?.[1] && match[2]) backlog.set(match[1], match[2] as "stub" | "done");
}

const found = new Map<string, string[]>();
for (const top of SCAN) {
	for (const path of files(join(ROOT, top))) {
		for (const match of readFileSync(path, "utf8").matchAll(PLACEHOLDER)) {
			const id = match[1];
			if (!id) continue;
			const where = found.get(id) ?? [];
			where.push(relative(ROOT, path));
			found.set(id, where);
		}
	}
}

const problems: string[] = [];
for (const [id, where] of found) {
	const status = backlog.get(id);
	if (status === undefined)
		problems.push(`${id} is used in ${where[0]} but missing from the backlog`);
	if (status === "done")
		problems.push(`${id} is marked done but still has placeholders: ${where.join(", ")}`);
}
for (const [id, status] of backlog) {
	if (status === "stub" && !found.has(id))
		problems.push(`${id} is marked stub but no placeholder exists in the code`);
}

const open = [...backlog].filter(([, status]) => status === "stub").length;
const done = backlog.size - open;
const placeholders = [...found.values()].reduce((sum, where) => sum + where.length, 0);
console.log(
	`Backlog: ${backlog.size} features, ${done} done, ${open} open. Placeholders in code: ${placeholders}.`,
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
