/**
 * @feature CLOUD-06 Keep work across sandbox restarts
 * Owns: which sandbox directories are saved to R2 and restored, the records the Durable Object
 * keeps, and the internal URL the sandbox entry calls at a turn end.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 ("Keeping work": an R2 directory backup of the
 * workspace and the agent's transcripts, taken at each turn end) and its spike result (a restart
 * without the method loses everything; restoring `/workspace` and `/root/.claude` brought back the
 * uncommitted files and the transcript Claude resumed). Research: sessions.md section 8 (the agent
 * resumes from its own transcript store; the cloud variant rehydrates sessions from a persisted
 * store) and other-runners.md (Codex resumes its thread from `$HOME/.codex`).
 * Must handle: a stopped sandbox is never started to back it up (the spike's backup bug); a
 * directory the agent never created is skipped rather than saved as an error; the newest backup of
 * each directory replaces the last, so the bucket does not grow with the number of turns; a restore
 * that fails leaves the error with the caller instead of pretending the work came back.
 * Our design choice: the turn-end signal is the relay's `liveState: idle`, the same signal D101
 * uses for the keep-alive alarm, and the sandbox entry reports it to the Worker over an internal
 * hostname (D104). The spike named this signal as missing and did not build it.
 * Our design choice: `/workspace` is saved whole, with no gitignore exclude, because a restart has
 * no setup rerun yet: an installed dependency has to survive with the work that needs it.
 * Test first: a backup replaces the previous record for its directory and deletes the old object.
 */
import type { DirectoryBackupRecord } from "@cloudflare/sandbox";

/** The R2 binding the gateway reads, from `wrangler.jsonc`. */
export const BACKUP_BINDING = "BACKUPS";
/** The key prefix of every backup object this Worker writes. */
export const BACKUP_PREFIX = "workspace-backups/";

/** One directory the product saves, with the label that goes in its record. */
export interface BackupDir {
	readonly dir: string;
	readonly label: string;
}

/**
 * The directories a cloud workspace keeps. `/workspace` holds the repository and its uncommitted
 * work; `/root/.claude` and `/root/.codex` hold the agents' transcripts, which is how a chat
 * resumes after a restart (HOME is `/root` in `CONTAINER_ENV`).
 */
export const CLOUD_BACKUP_DIRS: readonly BackupDir[] = Object.freeze([
	{ dir: "/workspace", label: "workspace" },
	{ dir: "/root/.claude", label: "Claude transcripts" },
	{ dir: "/root/.codex", label: "Codex transcripts" },
]);

/** The part of `DirectoryBackup` this module needs, so its decisions can be tested without a container. */
export interface DirectoryBackupStore {
	backup(options: { dir: string; name?: string }): Promise<DirectoryBackupRecord>;
	restore(record: DirectoryBackupRecord): Promise<void>;
	delete(record: DirectoryBackupRecord): Promise<void>;
}

/** Where the Durable Object keeps the latest record of each directory. */
export interface BackupLedger {
	read(): Promise<readonly DirectoryBackupRecord[]>;
	write(records: readonly DirectoryBackupRecord[]): Promise<void>;
}

/** One directory's saved backup, as the state route reports it. */
export interface BackupSummary {
	readonly id: string;
	readonly dir: string;
	readonly size: number;
}

/** What one collection of backups did. */
export interface BackupResult {
	readonly saved: BackupSummary[];
	readonly skipped: string[];
	readonly records: DirectoryBackupRecord[];
}

/**
 * True when a backup failed because the directory does not exist. That is an expected state: an
 * agent that has never run has no transcript folder to save.
 */
export function isMissingDirectory(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const value = error as { name?: unknown; code?: unknown };
	return value.name === "SandboxFileError" && value.code === "ENOENT";
}

/** The store calls for one backup of every directory, without touching the ledger. */
export async function collectBackups(
	store: DirectoryBackupStore,
	dirs: readonly BackupDir[] = CLOUD_BACKUP_DIRS,
): Promise<BackupResult> {
	const saved: BackupSummary[] = [];
	const skipped: string[] = [];
	const records: DirectoryBackupRecord[] = [];
	for (const entry of dirs) {
		let record: DirectoryBackupRecord;
		try {
			record = await store.backup({ dir: entry.dir, name: entry.label });
		} catch (error) {
			if (isMissingDirectory(error)) {
				skipped.push(entry.dir);
				continue;
			}
			throw error;
		}
		records.push(record);
		saved.push({ id: record.id, dir: record.dir, size: record.size });
	}
	return { saved, skipped, records };
}

/**
 * Saves every directory, then stores the new records and deletes the objects they replaced. The
 * records are stored before an old object is deleted, so a crash in between leaves one spare
 * object, never a record that points at nothing.
 */
export async function saveWorkspace(
	store: DirectoryBackupStore,
	ledger: BackupLedger,
	dirs: readonly BackupDir[] = CLOUD_BACKUP_DIRS,
): Promise<{ saved: BackupSummary[]; skipped: string[] }> {
	const before = await ledger.read();
	const collected = await collectBackups(store, dirs);
	if (collected.records.length === 0) {
		return { saved: [], skipped: collected.skipped };
	}
	const next: DirectoryBackupRecord[] = [];
	const replaced: DirectoryBackupRecord[] = [];
	for (const record of collected.records) {
		const earlier = before.filter((saved) => saved.dir === record.dir);
		replaced.push(...earlier);
		next.push(record);
	}
	for (const record of before) {
		if (!next.some((saved) => saved.dir === record.dir)) next.push(record);
	}
	await ledger.write(next);
	for (const record of replaced) await store.delete(record);
	return { saved: collected.saved, skipped: collected.skipped };
}

/** Restores every saved directory, in the order the records were stored. */
export async function restoreWorkspace(
	store: DirectoryBackupStore,
	ledger: BackupLedger,
): Promise<{ restored: string[] }> {
	const records = await ledger.read();
	const latest = new Map<string, DirectoryBackupRecord>();
	for (const record of records) {
		latest.delete(record.dir);
		latest.set(record.dir, record);
	}
	const restored: string[] = [];
	for (const record of latest.values()) {
		await store.restore(record);
		restored.push(record.dir);
	}
	return { restored };
}

/** The host the sandbox entry uses to reach the Worker's outbound handler. Never routable externally. */
export const TURN_END_HOST = "conducted.internal";
/** The path before the workspace name. */
export const TURN_END_PATH = "/turn-end";

/** The internal URL the entry calls when the last running chat goes idle. */
export function turnEndUrl(workspaceName: string): string {
	return `http://${TURN_END_HOST}${TURN_END_PATH}/${encodeURIComponent(workspaceName)}`;
}

/** The workspace a turn-end URL names, or null when the URL is not one. */
export function turnEndWorkspaceName(url: URL): string | null {
	if (url.protocol !== "http:" || url.hostname !== TURN_END_HOST) return null;
	const prefix = `${TURN_END_PATH}/`;
	if (!url.pathname.startsWith(prefix)) return null;
	const raw = url.pathname.slice(prefix.length);
	if (raw === "" || raw.includes("/")) return null;
	try {
		const name = decodeURIComponent(raw);
		return name === "" ? null : name;
	} catch {
		return null;
	}
}
