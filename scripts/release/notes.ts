/**
 * Prints one version's section of `CHANGELOG.md`, which is the body of its GitHub release
 * (PLAT-39). The workflow writes the output to a file and gives it to the release command.
 *
 * Usage: bun scripts/release/notes.ts v0.2.2
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sectionFor } from "./changelog.ts";
import { readTag } from "./tag.ts";

const root = join(import.meta.dir, "../..");
const tag = process.argv[2];
const release = tag === undefined ? null : readTag(tag);

if (release === null) {
	console.error("Usage: bun scripts/release/notes.ts <vX.Y.Z>");
	process.exit(64);
}

const section = sectionFor(readFileSync(join(root, "CHANGELOG.md"), "utf8"), release.version);
if (section === null) {
	console.error(`CHANGELOG.md has no section for ${release.version}.`);
	process.exit(1);
}
console.log(section);
