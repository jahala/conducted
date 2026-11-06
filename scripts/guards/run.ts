/**
 * Runs every guard against the repo and prints each one's problems. It runs them all, so one run
 * shows every problem, and exits 1 when any guard found one.
 * Usage: bun scripts/guards/run.ts
 */
import { join } from "node:path";
import { checkDataModel } from "./data-model.ts";
import { checkDocs } from "./docs.ts";
import type { Problem } from "./lib.ts";
import { checkMigrations } from "./migrations.ts";
import { checkHeaders, checkMarkers } from "./source-rules.ts";
import {
	checkMigrationList,
	checkPlaceholderTests,
	checkShellPrograms,
	checkTauriCommands,
	checkTestOnlyExports,
	checkUnwiredDeps,
} from "./structure.ts";
import { checkTestScripts } from "./test-scripts.ts";
import { checkAllTestShapes, type GuardName } from "./test-shapes.ts";
import { checkVersions } from "./versions.ts";
import { checkWorkflows } from "./workflows.ts";

const root = join(import.meta.dir, "../..");
// The five test-shape guards share one scan of every test file and the code it reaches.
let shapes: Promise<Record<GuardName, Problem[]>> | undefined;
const shape = (guard: GuardName) => async (): Promise<Problem[]> => {
	shapes ??= checkAllTestShapes(root);
	return (await shapes)[guard];
};
const guards: [string, (root: string) => Problem[] | Promise<Problem[]>][] = [
	["docs", checkDocs],
	["data-model", checkDataModel],
	["migrations", checkMigrations],
	["headers", checkHeaders],
	["markers", checkMarkers],
	["versions", checkVersions],
	["test-scripts", checkTestScripts],
	["workflows", checkWorkflows],
	["commands", checkTauriCommands],
	["programs", checkShellPrograms],
	["migration-list", checkMigrationList],
	["placeholder-tests", checkPlaceholderTests],
	["test-only-exports", checkTestOnlyExports],
	["unwired-deps", checkUnwiredDeps],
	["tests-cannot-fail", shape("tests-cannot-fail")],
	["mocking-the-thing", shape("mocking-the-thing")],
	["stand-in-home", shape("stand-in-home")],
	["time-and-leaks", shape("time-and-leaks")],
	["tests-cannot-pass", shape("tests-cannot-pass")],
];

let failed = 0;
for (const [name, check] of guards) {
	const problems = await check(root);
	console.log(`${problems.length === 0 ? "ok  " : "FAIL"} ${name}`);
	for (const problem of problems) console.log(`       ${problem.message}`);
	failed += problems.length;
}
if (failed > 0) process.exit(1);
