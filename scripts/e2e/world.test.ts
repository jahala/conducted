/**
 * Tests the end-to-end seeding (world.ts) without the app: over a database migrated the way the
 * tests' own database is (apps/desktop/src/test/sqlite.ts: the app's pragmas, then every migration
 * in order), the seeding writes its rows and leaves no connection to the file open.
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_PRAGMAS } from "../../apps/desktop/src/platform/queued-database.ts";
import { type FreshFolder, ROOT } from "./harness.ts";
import { seedWorld } from "./world.ts";

const MIGRATIONS = join(ROOT, "apps/desktop/src-tauri/migrations");

/** A fresh folder whose database holds every migration, as the app's first launch leaves it. */
function migratedFolder(root: string): FreshFolder {
	const home = join(root, "home");
	const folder: FreshFolder = {
		root,
		home,
		tmp: join(root, "tmp"),
		exe: join(root, "Conducted.app/Contents/MacOS/conducted"),
		profile: join(root, "sandbox.sb"),
		appData: join(home, "Library/Application Support/build.conducted.app"),
		probe: join(root, "refused/probe"),
		programRoots: [root],
	};
	mkdirSync(folder.appData, { recursive: true });
	const db = new Database(join(folder.appData, "conducted.db"));
	for (const pragma of DATABASE_PRAGMAS) db.run(pragma);
	for (const name of readdirSync(MIGRATIONS)
		.filter((file) => file.endsWith(".sql"))
		.sort()) {
		db.run(readFileSync(join(MIGRATIONS, name), "utf8"));
	}
	db.close(true);
	return folder;
}

/**
 * The files under `dir` this process holds open: from `/proc` on Linux, from `lsof` on macOS. A
 * connection SQLite has not closed yet holds its database file.
 */
function openFilesUnder(dir: string): string[] {
	const held = existsSync("/proc/self/fd")
		? readdirSync("/proc/self/fd").map((fd) => {
				try {
					return readlinkSync(join("/proc/self/fd", fd));
				} catch {
					return "";
				}
			})
		: spawnSync("/usr/sbin/lsof", ["-p", String(process.pid), "-Fn"], { encoding: "utf8" })
				.stdout.split("\n")
				.filter((line) => line.startsWith("n"))
				.map((line) => line.slice(1));
	return held.filter((path) => path.startsWith(`${dir}/`));
}

describe("the end-to-end seeding", () => {
	it("writes the world and leaves no connection to the database open", async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "e2e-world-")));
		try {
			const folder = migratedFolder(root);
			const file = join(folder.appData, "conducted.db");
			expect(openFilesUnder(folder.appData)).toEqual([]);
			const world = await seedWorld(folder);
			// `close()` leaves a connection open while any statement of it is not finalized, until the
			// garbage collector finalizes them; its database and WAL files stay open meanwhile.
			expect(openFilesUnder(folder.appData)).toEqual([]);
			const read = new Database(file, { readonly: true });
			try {
				const count = read.query("SELECT count(*) AS n FROM workspaces").get() as { n: number };
				expect(count.n).toBe(world.local.length + 1);
			} finally {
				read.close(true);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
