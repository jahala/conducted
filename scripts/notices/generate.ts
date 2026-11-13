/**
 * Writes the third-party notices file the app bundle carries (issue #577, D148), from what
 * `collect.ts` finds the app ships, and prints how many entries each kind has and which carry no
 * licence file. `pnpm guards` fails while the committed file differs from what this would write.
 *
 * Usage: bun scripts/notices/generate.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NOTICES_PATH } from "../../apps/desktop/src-tauri/release/bundle.ts";
import { collectAll, runCommand } from "./collect.ts";
import { entryKey, renderNotices } from "./notices.ts";

const root = join(import.meta.dir, "../..");
const entries = collectAll(root, runCommand);
if (!entries.ok) {
	console.error(entries.error.message);
	process.exit(1);
}
writeFileSync(NOTICES_PATH, renderNotices(entries.value));
for (const ecosystem of ["npm", "cargo", "other"] as const) {
	const count = entries.value.filter((entry) => entry.ecosystem === ecosystem).length;
	console.log(`${ecosystem}: ${count}`);
}
const bare = entries.value
	.filter((entry) => entry.files.length === 0)
	.map(entryKey)
	.sort();
if (bare.length > 0) {
	console.log(`${bare.length} carry no licence or notice file:\n  ${bare.join("\n  ")}`);
}
console.log(`Wrote ${NOTICES_PATH}`);
