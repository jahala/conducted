/**
 * Runs every guard against the repo and prints each one's problems. It runs them all, so one run
 * shows every problem, and exits 1 when any guard found one.
 * Usage: bun scripts/guards/run.ts
 */
import { join } from "node:path";
import { checkConductorCode } from "./conductor-code.ts";
import { checkDataModel } from "./data-model.ts";
import { checkDocs } from "./docs.ts";
import { checkHeaderClaims } from "./header-claims.ts";
import type { Problem } from "./lib.ts";
import { checkLifetimeLimits } from "./lifetime-limits.ts";
import { checkLocalStorageKeys } from "./local-storage-keys.ts";
import { checkMigrations } from "./migrations.ts";
import { checkModuleState } from "./module-state.ts";
import { checkNotices } from "./notices.ts";
import { checkParityOwners } from "./parity-owners.ts";
import { checkSettingsKeys } from "./settings-keys.ts";
import { checkSidecarEdges } from "./sidecar-edges.ts";
import { checkSite } from "./site.ts";
import { checkHeaders, checkMarkers, checkOurName } from "./source-rules.ts";
import {
	checkBrowserImports,
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
import { checkWorkflows, checkWorkflowTools } from "./workflows.ts";

const root = join(import.meta.dir, "../..");
// The five test-shape guards share one scan of every test file and the code it reaches.
let shapes: Promise<Record<GuardName, Problem[]>> | undefined;
const shape = (guard: GuardName) => async (): Promise<Problem[]> => {
	shapes ??= checkAllTestShapes(root);
	return (await shapes)[guard];
};
const guards: [string, (root: string) => Problem[] | Promise<Problem[]>][] = [
	["docs", checkDocs],
	["site", checkSite],
	["data-model", checkDataModel],
	["migrations", checkMigrations],
	["module-state", checkModuleState],
	["sidecar-edges", checkSidecarEdges],
	["lifetime-limits", checkLifetimeLimits],
	["settings-keys", checkSettingsKeys],
	["local-storage-keys", checkLocalStorageKeys],
	["headers", checkHeaders],
	["header-claims", checkHeaderClaims],
	["markers", checkMarkers],
	["our-name", checkOurName],
	["versions", checkVersions],
	["test-scripts", checkTestScripts],
	["workflows", checkWorkflows],
	["workflow-tools", checkWorkflowTools],
	["commands", checkTauriCommands],
	["programs", checkShellPrograms],
	["browser-imports", checkBrowserImports],
	["migration-list", checkMigrationList],
	["placeholder-tests", checkPlaceholderTests],
	["test-only-exports", checkTestOnlyExports],
	["unwired-deps", checkUnwiredDeps],
	["conductor-code", checkConductorCode],
	["notices", checkNotices],
	["parity-owners", checkParityOwners],
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
