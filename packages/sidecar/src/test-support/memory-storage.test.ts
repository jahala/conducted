/**
 * @feature SIDE-06 Write-ahead event log: the file storage port
 * Owns: the contract test of MemoryStorage. One script of storage calls runs on MemoryStorage and
 * on `createOutboxStorage` over a real folder, and both must give the same answers.
 * Test first: "write, read back, list and trash behave like the real folder".
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOutboxStorage } from "../outbox/node-storage.ts";
import { fileNameFor, type OutboxStorage } from "../outbox/outbox-file.ts";
import { MemoryStorage } from "./memory-storage.ts";

/** Runs one fixed script and returns what every call answered. */
async function transcriptOf(storage: OutboxStorage): Promise<unknown[]> {
	const first = fileNameFor("chat-a");
	const second = fileNameFor("chat-b");
	const steps: unknown[] = [];
	steps.push(await storage.list());
	steps.push(await storage.read(first));
	steps.push(await storage.writeAtomic(first, "one"));
	steps.push(await storage.read(first));
	steps.push(await storage.writeAtomic(first, "two"));
	steps.push(await storage.read(first));
	steps.push(await storage.writeAtomic(second, "other chat"));
	const listed = await storage.list();
	steps.push(listed.ok ? { ok: true, value: [...listed.value].sort() } : listed);
	steps.push(await storage.moveToTrash(first));
	steps.push(await storage.read(first));
	const afterTrash = await storage.list();
	steps.push(afterTrash.ok ? { ok: true, value: [...afterTrash.value].sort() } : afterTrash);
	steps.push(await storage.cleanTempFiles());
	return steps;
}

describe("SIDE-06 MemoryStorage against the real folder", () => {
	let root = "";

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), "conducted-memory-storage-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("write, read back, list and trash behave like the real folder", async () => {
		const real = createOutboxStorage(root, {
			runTrash: async (target) => {
				await rm(target, { force: true });
				return 0;
			},
		});

		const fromReal = await transcriptOf(real);
		const fromMemory = await transcriptOf(new MemoryStorage());

		expect(fromMemory).toEqual(fromReal);
		expect(fromReal).toEqual([
			{ ok: true, value: [] },
			{ ok: true, value: null },
			{ ok: true, value: undefined },
			{ ok: true, value: "one" },
			{ ok: true, value: undefined },
			{ ok: true, value: "two" },
			{ ok: true, value: undefined },
			{ ok: true, value: [fileNameFor("chat-a"), fileNameFor("chat-b")].sort() },
			{ ok: true, value: undefined },
			{ ok: true, value: null },
			{ ok: true, value: [fileNameFor("chat-b")] },
			{ ok: true, value: 0 },
		]);
	});

	test("a write that fails on demand leaves no file, like a disk that refuses the write", async () => {
		const memory = new MemoryStorage();
		memory.failWrites = 1;
		const name = fileNameFor("chat-a");

		const refused = await memory.writeAtomic(name, "lost");

		expect(refused.ok).toBe(false);
		expect(await memory.read(name)).toEqual({ ok: true, value: null });
	});

	test("a directory sync that fails after the rename leaves the file, as the real storage does", async () => {
		const name = fileNameFor("chat-a");
		const real = createOutboxStorage(root, {
			fsyncDirectory: async () => {
				throw new Error("fsync refused");
			},
		});
		const memory = new MemoryStorage();
		memory.failWrites = 1;
		memory.failCode = "outbox_dir_sync_failed";

		const fromReal = await real.writeAtomic(name, "durable content");
		const fromMemory = await memory.writeAtomic(name, "durable content");

		expect(!fromReal.ok && fromReal.error.code).toBe("outbox_dir_sync_failed");
		expect(!fromMemory.ok && fromMemory.error.code).toBe("outbox_dir_sync_failed");
		expect(await memory.read(name)).toEqual(await real.read(name));
	});
});
