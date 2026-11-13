/**
 * Guard: the third-party notices file the app bundle carries lists every package the app ships, as
 * `bun scripts/notices/generate.ts` would write it now (issue #577, D148). A dependency added,
 * removed or upgraded without writing the file again fails here, so nothing ships uncredited.
 * It runs pnpm and `cargo metadata`, which downloads the crates' sources when they are missing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { NOTICES_PATH } from "../../apps/desktop/src-tauri/release/bundle.ts";
import { collectAll, type RunCommand, runCommand } from "../notices/collect.ts";
import { noticesProblems } from "../notices/notices.ts";
import type { Problem } from "./lib.ts";

/** The committed file's path from the repository root. */
const NOTICES_FILE = relative(join(import.meta.dir, "../.."), NOTICES_PATH);

export function checkNotices(root: string, run: RunCommand = runCommand): Problem[] {
	const entries = collectAll(root, run);
	if (!entries.ok) return [{ guard: "notices", message: entries.error.message }];
	const path = join(root, NOTICES_FILE);
	const committed = existsSync(path) ? readFileSync(path, "utf8") : null;
	return noticesProblems(committed, entries.value, NOTICES_FILE).map((message) => ({
		guard: "notices",
		message,
	}));
}
