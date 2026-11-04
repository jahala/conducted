/**
 * Stops a run on the wrong runtime before any test starts, and says how to switch.
 * Node must match the major version in .node-version; Bun must match .bun-version on major and
 * minor. CI reads the same two files.
 *
 * Usage: bun scripts/check-runtime.ts   (the first step of `pnpm test`)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RuntimeProblem {
	runtime: "node" | "bun";
	expected: string;
	actual: string;
	fix: string;
}

export function checkRuntime(
	wanted: { node: string; bun: string },
	actual: { node: string; bun: string },
): RuntimeProblem[] {
	const problems: RuntimeProblem[] = [];
	const major = (version: string) => version.replace(/^v/, "").split(".")[0];
	const minor = (version: string) => version.replace(/^v/, "").split(".").slice(0, 2).join(".");
	if (major(actual.node) !== major(wanted.node)) {
		problems.push({
			runtime: "node",
			expected: `${major(wanted.node)}.x`,
			actual: actual.node,
			fix: `Install and select Node ${major(wanted.node)} (for example: fnm use ${major(wanted.node)})`,
		});
	}
	if (minor(actual.bun) !== minor(wanted.bun)) {
		problems.push({
			runtime: "bun",
			expected: wanted.bun,
			actual: actual.bun,
			fix: `bun upgrade --version ${wanted.bun}`,
		});
	}
	return problems;
}

if (import.meta.main) {
	const root = join(import.meta.dir, "..");
	const read = (name: string) => readFileSync(join(root, name), "utf8").trim();
	const node = Bun.spawnSync(["node", "--version"]).stdout.toString().trim();
	const problems = checkRuntime(
		{ node: read(".node-version"), bun: read(".bun-version") },
		{ node, bun: Bun.version },
	);
	for (const p of problems) {
		console.error(`Wrong ${p.runtime}: this repo uses ${p.expected}, found ${p.actual}. ${p.fix}`);
	}
	if (problems.length > 0) process.exit(1);
}
