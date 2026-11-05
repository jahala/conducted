/**
 * Runs every guard against the repo and fails on the first report with problems listed.
 * Usage: bun scripts/guards/run.ts
 */
import { join } from "node:path";
import { checkDataModel } from "./data-model.ts";
import { checkDocs } from "./docs.ts";
import type { Problem } from "./lib.ts";
import { checkMigrations } from "./migrations.ts";
import { checkHeaders, checkMarkers } from "./source-rules.ts";
import { checkTestScripts } from "./test-scripts.ts";
import { checkVersions } from "./versions.ts";
import { checkWorkflows } from "./workflows.ts";

const root = join(import.meta.dir, "../..");
const guards: [string, (root: string) => Problem[]][] = [
	["docs", checkDocs],
	["data-model", checkDataModel],
	["migrations", checkMigrations],
	["headers", checkHeaders],
	["markers", checkMarkers],
	["versions", checkVersions],
	["test-scripts", checkTestScripts],
	["workflows", checkWorkflows],
];

let failed = 0;
for (const [name, check] of guards) {
	const problems = check(root);
	console.log(`${problems.length === 0 ? "ok  " : "FAIL"} ${name}`);
	for (const problem of problems) console.log(`       ${problem.message}`);
	failed += problems.length;
}
if (failed > 0) process.exit(1);
