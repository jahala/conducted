/**
 * Publishes a tagged release on GitHub from the files the CI build made, with the body cut from
 * that version's `CHANGELOG.md` section (PLAT-37, PLAT-39). A tag with a suffix after the patch
 * number publishes a pre-release.
 *
 * Usage: bun scripts/release/publish.ts v0.2.2 <dmg> <archive> <sig> <latest.json> --notes-file <path>
 */
import { readTag } from "./tag.ts";
import { ghReleaseCommand } from "./updater.ts";

const args = process.argv.slice(2);
const tag = args[0];
const release = tag === undefined ? null : readTag(tag);
const notesAt = args.indexOf("--notes-file");
const notesFile = notesAt === -1 ? undefined : args[notesAt + 1];
const files = args.slice(1, notesAt === -1 ? undefined : notesAt);

if (release === null || files.length === 0 || notesFile === undefined) {
	console.error("Usage: bun scripts/release/publish.ts <vX.Y.Z> <files...> --notes-file <path>");
	process.exit(64);
}

const command = ghReleaseCommand(release.version, files, {
	notesFile,
	prerelease: release.prerelease,
});
console.log(command);
const result = Bun.spawnSync(["bash", "-lc", command], {
	stdin: "ignore",
	stdout: "inherit",
	stderr: "inherit",
	env: process.env,
});
if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
