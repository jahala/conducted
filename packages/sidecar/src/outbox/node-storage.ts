/**
 * @feature SIDE-06 Write-ahead event log: the file storage port
 * Owns: the node:fs implementation of OutboxStorage: one directory holding one JSON file per chat,
 * and the Trash moves that remove files for good.
 * Behaviour: research/conductor/sessions.md section 5 "Durable event outbox": a write goes to a
 * temp file with mode 0600, is synced, renamed over the target, and then the directory itself is
 * synced. Leaving the directory entry unsynced is reported as "outbox_dir_sync_failed", so the log
 * can mark that chat durability-uncertain.
 * Must handle: a missing directory (list creates it), a missing file (read returns null), a
 * leftover temp file (cleanTempFiles moves it to the Trash), a refused Trash command, a failed
 * file write or rename (the temp file is removed), and a directory fsync that fails on its own.
 * Test first: writeAtomic leaves one file with mode 0600 and no temp file, and cleanTempFiles moves
 * a stale temp file to the Trash.
 * Our design choice: the directory fsync is its own step, so a caller can tell a lost rename from a
 * lost directory entry. The Trash command and the directory fsync are parameters, so the tests do
 * not touch the user's Trash.
 */
import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { appError, err, ok, type Result } from "@conducted/shared";
import { messageOf } from "../util/errors.ts";
import type { OutboxStorage } from "./outbox-file.ts";

/** How this storage runs a file through the Trash. Returns the command's exit code. */
export type RunTrash = (target: string) => Promise<number>;

/** How this storage syncs a directory entry. Production opens the folder and calls sync. */
export type FsyncDirectory = (folder: string) => Promise<void>;

export interface OutboxStorageDeps {
	runTrash?: RunTrash;
	fsyncDirectory?: FsyncDirectory;
}

async function runTrashCommand(target: string): Promise<number> {
	const child = Bun.spawn({ cmd: ["trash", target], stderr: "ignore" });
	return child.exited;
}

async function fsyncDirectory(folder: string): Promise<void> {
	const handle = await open(folder, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** The production storage. Every operation stays inside `root`. */
export function createOutboxStorage(
	root: string,
	overrides: OutboxStorageDeps = {},
): OutboxStorage {
	const runTrash = overrides.runTrash ?? runTrashCommand;
	const syncDirectory = overrides.fsyncDirectory ?? fsyncDirectory;

	return {
		async list(): Promise<Result<string[]>> {
			try {
				await mkdir(root, { recursive: true, mode: 0o700 });
				return ok(await readdir(root));
			} catch (cause) {
				return err(appError("outbox_list_failed", messageOf(cause), cause));
			}
		},

		async read(fileName: string): Promise<Result<string | null>> {
			try {
				return ok(await readFile(path.join(root, fileName), "utf8"));
			} catch (cause) {
				if (isMissing(cause)) return ok(null);
				return err(appError("outbox_read_failed", messageOf(cause), cause));
			}
		},

		async writeAtomic(fileName: string, text: string): Promise<Result<void>> {
			const target = path.join(root, fileName);
			const temp = `${target}.${process.pid}.tmp`;
			try {
				await mkdir(root, { recursive: true, mode: 0o700 });
				const handle = await open(temp, "w", 0o600);
				try {
					await handle.writeFile(text);
					await handle.sync();
				} finally {
					await handle.close();
				}
				await rename(temp, target);
			} catch (cause) {
				await rm(temp, { force: true }).catch(() => {});
				return err(appError("outbox_write_failed", messageOf(cause), cause));
			}
			try {
				await syncDirectory(root);
			} catch (cause) {
				return err(appError("outbox_dir_sync_failed", messageOf(cause), cause));
			}
			return ok(undefined);
		},

		async moveToTrash(fileName: string): Promise<Result<void>> {
			try {
				const code = await runTrash(path.join(root, fileName));
				if (code !== 0) {
					return err(appError("trash_failed", `The Trash refused ${fileName}.`));
				}
				return ok(undefined);
			} catch (cause) {
				return err(appError("trash_failed", messageOf(cause), cause));
			}
		},

		async cleanTempFiles(): Promise<Result<number>> {
			let names: string[];
			try {
				names = await readdir(root);
			} catch (cause) {
				if (isMissing(cause)) return ok(0);
				return err(appError("outbox_clean_failed", messageOf(cause), cause));
			}
			let moved = 0;
			for (const name of names) {
				if (!name.endsWith(".tmp")) continue;
				try {
					if ((await runTrash(path.join(root, name))) === 0) moved += 1;
				} catch {
					// The temp file stays for the next open.
				}
			}
			return ok(moved);
		},
	};
}

function isMissing(cause: unknown): boolean {
	return (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		(cause as { code?: string }).code === "ENOENT"
	);
}
