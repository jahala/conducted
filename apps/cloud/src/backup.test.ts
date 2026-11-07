/**
 * @feature CLOUD-06 Keep work across sandbox restarts
 * Tests the backup ledger inside Cloudflare's runtime without a container: which directories are
 * saved, a missing directory is skipped, the newest record replaces the last and its old object is
 * deleted, a restore puts every saved directory back, and a stopped sandbox saves nothing.
 */

import { env } from "cloudflare:test";
import type { DirectoryBackupRecord } from "@cloudflare/sandbox";
import { describe, expect, it } from "vitest";
import {
	type BackupLedger,
	CLOUD_BACKUP_DIRS,
	type DirectoryBackupStore,
	isMissingDirectory,
	restoreWorkspace,
	saveWorkspace,
	turnEndUrl,
	turnEndWorkspaceName,
} from "./backup.ts";
import type { WorkspaceState } from "./workspace.ts";

function record(dir: string, id: string, size = 10): DirectoryBackupRecord {
	return { id, dir, size, sha256: "0".repeat(64), format: "tar+zstd/1" };
}

interface FakeStore extends DirectoryBackupStore {
	readonly backedUp: string[];
	readonly deleted: string[];
	readonly restored: string[];
}

/** A store that records its calls and fails a chosen directory as missing. */
function fakeStore(missing: readonly string[] = []): FakeStore {
	const backedUp: string[] = [];
	const deleted: string[] = [];
	const restored: string[] = [];
	let made = 0;
	return {
		backedUp,
		deleted,
		restored,
		async backup(options) {
			if (missing.includes(options.dir)) {
				throw Object.assign(new Error(`No such directory: ${options.dir}`), {
					name: "SandboxFileError",
					code: "ENOENT",
					operation: "backup",
					path: options.dir,
					detail: "missing",
				});
			}
			backedUp.push(options.dir);
			made += 1;
			return record(options.dir, `backup-${made}`);
		},
		async restore(saved) {
			restored.push(saved.dir);
		},
		async delete(saved) {
			deleted.push(saved.id);
		},
	};
}

function ledger(initial: readonly DirectoryBackupRecord[] = []): BackupLedger & {
	value: DirectoryBackupRecord[];
} {
	const state = { value: [...initial] };
	return {
		get value() {
			return state.value;
		},
		read: async () => state.value,
		write: async (records) => {
			state.value = [...records];
		},
	};
}

describe("CLOUD-06 the backup ledger", () => {
	it("saves each directory and skips one the agent never created", async () => {
		const store = fakeStore(["/root/.codex"]);
		const db = ledger();
		const report = await saveWorkspace(store, db);

		expect(store.backedUp).toEqual(["/workspace", "/root/.claude"]);
		expect(report.skipped).toEqual(["/root/.codex"]);
		expect(db.value.map((saved) => saved.dir).sort()).toEqual(
			[...CLOUD_BACKUP_DIRS.map((entry) => entry.dir)]
				.filter((dir) => dir !== "/root/.codex")
				.sort(),
		);
	});

	it("a backup replaces the previous record for its directory and deletes the old object", async () => {
		const old = record("/workspace", "old-workspace");
		const other = record("/root/.claude", "claude");
		const store = fakeStore();
		const db = ledger([old, other]);
		await saveWorkspace(store, db, [{ dir: "/workspace", label: "workspace" }]);

		expect(store.deleted).toEqual(["old-workspace"]);
		expect(db.value).toHaveLength(2);
		expect(db.value.find((saved) => saved.dir === "/workspace")?.id).not.toBe("old-workspace");
		expect(db.value.find((saved) => saved.dir === "/root/.claude")?.id).toBe("claude");
	});

	it("leaves the stored records alone when nothing new was saved", async () => {
		const store = fakeStore(["/workspace", "/root/.claude", "/root/.codex"]);
		const db = ledger([record("/workspace", "kept")]);
		const report = await saveWorkspace(store, db);
		expect(report.saved).toEqual([]);
		expect(db.value.map((saved) => saved.id)).toEqual(["kept"]);
		expect(store.deleted).toEqual([]);
	});

	it("restores every saved directory", async () => {
		const store = fakeStore();
		const db = ledger([record("/workspace", "a"), record("/root/.claude", "b")]);
		const report = await restoreWorkspace(store, db);
		expect(store.restored).toEqual(["/workspace", "/root/.claude"]);
		expect(report.restored).toEqual(["/workspace", "/root/.claude"]);
	});

	it("recognizes a missing directory and nothing else", () => {
		expect(isMissingDirectory({ name: "SandboxFileError", code: "ENOENT" })).toBe(true);
		expect(isMissingDirectory({ name: "SandboxFileError", code: "EACCES" })).toBe(false);
		expect(isMissingDirectory(new Error("ENOENT"))).toBe(false);
		expect(isMissingDirectory(null)).toBe(false);
	});

	it("reads a turn-end URL back to its workspace name", () => {
		expect(turnEndWorkspaceName(new URL(turnEndUrl("oslo-1")))).toBe("oslo-1");
		expect(turnEndWorkspaceName(new URL("https://conducted.internal/turn-end/oslo-1"))).toBeNull();
		expect(turnEndWorkspaceName(new URL("http://elsewhere.test/turn-end/oslo-1"))).toBeNull();
		expect(turnEndWorkspaceName(new URL("http://conducted.internal/other/oslo-1"))).toBeNull();
		expect(turnEndWorkspaceName(new URL("http://conducted.internal/turn-end/a/b"))).toBeNull();
	});
});

describe("CLOUD-06 a stopped sandbox", () => {
	it("saves no backup and is not started", async () => {
		const workspace = env.WORKSPACE.getByName("backup-stopped");
		const report = await workspace.backupAtTurnEnd();
		expect(report).toEqual({ ran: false, saved: [], skipped: [] });
		const state = (await workspace.state()) as WorkspaceState;
		expect(state.backups).toEqual([]);
	});
});
