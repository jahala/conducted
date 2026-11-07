/**
 * Stops a release when its tag disagrees with any version file (PLAT-37). The workflow runs this
 * before it builds, so a mismatched tag never publishes a build under another version's name.
 *
 * Usage: bun scripts/release/tag-check.ts v0.2.2
 */
import { join } from "node:path";
import { readVersion, VERSION_FILES } from "../guards/versions.ts";
import { tagProblems } from "./tag.ts";

const root = join(import.meta.dir, "../..");
const tag = process.argv[2];

if (!tag) {
	console.error("Usage: bun scripts/release/tag-check.ts <vX.Y.Z>");
	process.exit(64);
}

const versions = VERSION_FILES.map((file) => [file, readVersion(root, file)] as const);
const problems = tagProblems(tag, versions);
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log(`Tag ${tag} matches every version file.`);
