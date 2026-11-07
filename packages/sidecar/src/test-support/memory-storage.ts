/**
 * @feature SIDE-06 Write-ahead event log: the file storage port
 * Owns: the one in-memory OutboxStorage that outbox and session tests use. It keeps files in a map
 * and records the writes, the files sent to the Trash and the clean-up calls.
 * Behaviour: outbox/node-storage.ts. memory-storage.test.ts runs the same cases on this class and
 * on `createOutboxStorage` over a real folder and compares the answers.
 * Contract test: memory-storage.test.ts
 * Must handle: a write that fails on demand (`failWrites` and `failCode`), a directory sync that
 * fails after the file landed (`failCode` "outbox_dir_sync_failed"), a hook that runs before a
 * file is written (`beforeWrite`, which a test uses to make a write as slow as a disk's), and a
 * hook that runs before a file goes to the Trash (`beforeTrash`).
 * Test first: memory-storage.test.ts, "write, read back, list and trash behave like the real folder".
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type { OutboxStorage } from "../outbox/outbox-file.ts";

export class MemoryStorage implements OutboxStorage {
	readonly files = new Map<string, string>();
	readonly writes: { fileName: string; text: string }[] = [];
	readonly trashed: string[] = [];
	cleanCalls = 0;
	failWrites = 0;
	failCode = "outbox_write_failed";
	beforeWrite: ((text: string) => Promise<void>) | null = null;
	beforeTrash: (() => Promise<void>) | null = null;

	async list(): Promise<Result<string[], AppError>> {
		return ok([...this.files.keys()]);
	}

	async read(fileName: string): Promise<Result<string | null, AppError>> {
		return ok(this.files.get(fileName) ?? null);
	}

	async writeAtomic(fileName: string, text: string): Promise<Result<void, AppError>> {
		if (this.beforeWrite !== null) await this.beforeWrite(text);
		this.writes.push({ fileName, text });
		if (this.failWrites > 0) {
			this.failWrites -= 1;
			// A directory fsync fails after the rename landed, so the file is there but the
			// directory entry may not be.
			if (this.failCode === "outbox_dir_sync_failed") this.files.set(fileName, text);
			return err(appError(this.failCode, "The disk refused the write."));
		}
		this.files.set(fileName, text);
		return ok(undefined);
	}

	async moveToTrash(fileName: string): Promise<Result<void, AppError>> {
		if (this.beforeTrash !== null) await this.beforeTrash();
		this.trashed.push(fileName);
		this.files.delete(fileName);
		return ok(undefined);
	}

	async cleanTempFiles(): Promise<Result<number, AppError>> {
		this.cleanCalls += 1;
		return ok(0);
	}
}
