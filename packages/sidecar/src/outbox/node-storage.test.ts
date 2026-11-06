import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKeyedQueue } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import { FileEventOutbox } from "./event-outbox.ts";
import { createOutboxStorage } from "./node-storage.ts";
import { fileNameFor } from "./outbox-file.ts";

describe("SIDE-06 node outbox storage", () => {
	let root = "";

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), "conducted-outbox-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("SIDE-06 a write is one file with mode 0600, no temp file, and it reads back", async () => {
		const storage = createOutboxStorage(root);
		const name = fileNameFor("a/b");

		expect(await storage.writeAtomic(name, "hello")).toEqual({ ok: true, value: undefined });
		expect(await storage.read(name)).toEqual({ ok: true, value: "hello" });
		expect((await storage.list()).ok).toBe(true);

		const names = await readdir(root);
		expect(names.sort()).toEqual([name]);
		const info = await stat(path.join(root, name));
		expect(info.mode & 0o777).toBe(0o600);
	});

	test("SIDE-06 list creates a missing folder and read of a missing file is null", async () => {
		const missing = path.join(root, "nested", "outbox");
		const storage = createOutboxStorage(missing);

		expect(await storage.list()).toEqual({ ok: true, value: [] });
		expect((await stat(missing)).isDirectory()).toBe(true);
		expect(await storage.read(fileNameFor("gone"))).toEqual({ ok: true, value: null });
	});

	test("SIDE-06 cleaning a missing folder is zero, not an error", async () => {
		const storage = createOutboxStorage(path.join(root, "absent"));
		expect(await storage.cleanTempFiles()).toEqual({ ok: true, value: 0 });
	});

	test("SIDE-06 cleanTempFiles moves every .tmp file to the Trash and keeps the rest", async () => {
		await mkdir(root, { recursive: true });
		const stale = path.join(root, "stale.json.123.tmp");
		const keep = path.join(root, fileNameFor("kept"));
		await writeFile(stale, "half a write");
		await writeFile(keep, "{}");
		const trashed: string[] = [];
		const storage = createOutboxStorage(root, {
			runTrash: async (target) => {
				trashed.push(target);
				await rm(target, { force: true });
				return 0;
			},
		});

		expect(await storage.cleanTempFiles()).toEqual({ ok: true, value: 1 });
		expect(trashed).toEqual([stale]);
		expect((await readdir(root)).sort()).toEqual([path.basename(keep)]);
	});

	test("SIDE-06 cleanTempFiles reports a temp file the Trash refused", async () => {
		await mkdir(root, { recursive: true });
		await writeFile(path.join(root, "stuck.json.9.tmp"), "half a write");
		const refusing = createOutboxStorage(root, { runTrash: async () => 1 });
		const throwing = createOutboxStorage(root, {
			runTrash: async () => {
				throw new Error("no trash tool");
			},
		});

		for (const storage of [refusing, throwing]) {
			const result = await storage.cleanTempFiles();
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.message).toContain("stuck.json.9.tmp");
		}
	});

	test("SIDE-06 open moves a leftover .tmp file to the Trash through the real storage", async () => {
		await mkdir(root, { recursive: true });
		const leftover = path.join(root, "crash.json.1.tmp");
		await writeFile(leftover, "half a write");
		const trashed: string[] = [];
		const storage = createOutboxStorage(root, {
			runTrash: async (target) => {
				trashed.push(target);
				await rm(target, { force: true });
				return 0;
			},
		});
		const outbox = new FileEventOutbox({
			storage,
			queue: createKeyedQueue(),
			clock: { now: () => 1 },
			logger: createLogger({
				sink: () => {},
				clock: { now: () => 0 },
				level: "debug",
				scope: "test",
			}),
		});

		expect(await outbox.open()).toEqual({ ok: true, value: [] });
		expect(trashed).toEqual([leftover]);
		expect(await readdir(root)).toEqual([]);
	});

	test("SIDE-06 a refused Trash command is an error and leaves the file", async () => {
		await mkdir(root, { recursive: true });
		const name = fileNameFor("kept");
		await writeFile(path.join(root, name), "{}");
		const storage = createOutboxStorage(root, { runTrash: async () => 1 });

		const result = await storage.moveToTrash(name);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("trash_failed");
		expect(await readdir(root)).toEqual([name]);
	});

	test("SIDE-06 a directory fsync failure is its own error code and the file still lands", async () => {
		const storage = createOutboxStorage(root, {
			fsyncDirectory: async () => {
				throw new Error("fsync refused");
			},
		});
		const name = fileNameFor("a");

		const written = await storage.writeAtomic(name, "durable content");
		expect(written.ok).toBe(false);
		if (written.ok) return;
		expect(written.error.code).toBe("outbox_dir_sync_failed");
		// The rename already happened; only the directory entry is unconfirmed.
		expect(await storage.read(name)).toEqual({ ok: true, value: "durable content" });
	});
});
