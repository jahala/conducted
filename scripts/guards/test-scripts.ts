/**
 * Guard: every workspace package that has test files runs them from its `test` script, and no
 * `test` script passes when it finds no tests. Without this, a broken test glob turns the whole
 * suite green with nothing run.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Problem, read, rel, TEST_FILE, walk } from "./lib.ts";

const PACKAGE_PARENTS = ["apps", "packages"];
const NO_TESTS_OK = /pass-?with-?no-?tests/i;

interface PackageJson {
	scripts?: Record<string, string>;
}

export function checkTestScripts(root: string): Problem[] {
	const problems: Problem[] = [];
	for (const parent of PACKAGE_PARENTS) {
		if (!existsSync(join(root, parent))) continue;
		for (const name of readdirSync(join(root, parent))) {
			const manifest = join(root, parent, name, "package.json");
			if (!existsSync(manifest)) continue;
			const label = rel(root, manifest);
			const script = (JSON.parse(read(manifest)) as PackageJson).scripts?.test;
			const hasTests = !walk(root, join(root, parent, name), TEST_FILE).next().done;
			if (script !== undefined && NO_TESTS_OK.test(script)) {
				problems.push({
					guard: "test-scripts",
					message: `${label} has a test script that passes when no tests are found`,
				});
			}
			if (script === undefined && hasTests) {
				problems.push({
					guard: "test-scripts",
					message: `${label} has test files but no "test" script, so nothing runs them`,
				});
			}
		}
	}
	return problems;
}
