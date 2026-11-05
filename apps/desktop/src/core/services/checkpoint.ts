/**
 * @feature CHAT-15 Checkpoints: per-turn changes, revert and fork; REV-09 Turn changes from checkpoints; DATA-06 Prune turn snapshots
 * Owns: reading the private checkpoint refs that the sidecar writes around each turn, listing
 * what a turn changed, counting files that changed since a checkpoint, restoring the working
 * tree to a turn's start, and removing a chat's checkpoint refs when it is deleted or 30 days
 * after its workspace is archived.
 * Behaviour: services-map.md 3.12 (checkpoint ids, `checkpointer.sh` subcommands, frontend uses),
 * sessions-and-chats.md "Checkpoints, revert, fork and archive", sessions.md 7 (when
 * checkpoints are taken; skipped on merge, rebase or conflicts), data-model.md (turn snapshots'
 * lifetime), D036 (rewind keeps events; refs are pruned).
 * Must handle: a turn with no start checkpoint (the chat gave no restore point: revert and fork
 * are disabled with a reason); refs that are not written yet when the turn just ended (wait a
 * short time, then say "not ready"); more than 200 changed files (the end event omits the list,
 * so compute it from the refs, capped); restoring needs a clean git state, and a command that
 * cannot start, a non-zero exit or any stderr fails the revert without a retry; revert restores
 * first and only then marks later events as reverted, so a failed restore changes nothing, and
 * says "No changes or conversation history have been reverted" when restore fails; fork starts
 * a new chat whose agent resumes the old history only up to the chosen turn; the original chat
 * is untouched; refs are removed only by the two prune methods (when a chat is deleted, and 30
 * days after its workspace was archived), never by revert or fork; the archive prune counts from
 * `archived_at`, not from a later edit of the archived workspace; pruning one chat never touches
 * another chat's refs, even when ids share a prefix. The archive prune runs from the startup
 * checkpoint-pruning step; the chat prune runs when the chat is deleted.
 * The per-turn change list is read with the checkpointer's own diff, so it includes untracked
 * files and honours the repository's ignore rules like the checkpoint itself. It is cached per
 * chat and turn; every caller gets its own copy of the list, so one caller's change cannot reach
 * the cache. The cache holds at most 5 MB and evicts the oldest turns first.
 * Our design choice: a revert restores files and hides later events in one user action when the
 * "Also reset files" preference is on. The chat's agent process is not restarted here.
 * Test first: reverting to a turn without a start checkpoint returns an Err and changes nothing.
 */
import type { FileChange } from "@conducted/protocol";
import {
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type SessionId,
	type TurnId,
} from "@conducted/shared";
import { ageCutoff } from "../db/lifetime.ts";
import type { Repositories } from "../db/repositories.ts";
import type { SessionEventRepository } from "../db/session-events.ts";
import {
	checkpointerDiff,
	checkpointerRestore,
	forEachRefNames,
	showRefVerify,
	updateRefDelete,
} from "../git/commands.ts";
import {
	CHECKPOINT_REF_PREFIX,
	checkpointRef,
	sessionCheckpointRefPrefix,
	turnCheckpointId,
} from "../git/refs.ts";
import type { GitRunner } from "../git/runner.ts";
import { mergeChanges, parseNameStatus, parseNumstat } from "../git/status.ts";
import type { Session, Workspace } from "../model.ts";

/** How long a finished turn's change list waits for its two checkpoint refs. */
export const CHECKPOINT_READY_TIMEOUT_MS = 2_000;
/** Days after a workspace is archived when its chats' checkpoint refs are pruned (data-model). */
export const CHECKPOINT_PRUNE_AFTER_DAYS = 30;
/** How long each wait between ref checks lasts. */
export const CHECKPOINT_READY_POLL_MS = 50;
/** Most memory the per-turn change list cache may hold (services-map 3.12.3). */
export const TURN_CHANGES_CACHE_BYTES = 5 * 1024 * 1024;

/** The exact failure text a reset shows when the checkpoint cannot be restored (services-map 3.12.3). */
const REVERT_FAILED_MESSAGE = "No changes or conversation history have been reverted.";
/** A turn that never got a start checkpoint gives the chat no place to return to. */
const CHECKPOINT_MISSING_MESSAGE = "This turn has no checkpoint to revert to.";

const utf8 = new TextEncoder();

/** A caller's own copy, so changing a result never reaches the cache. */
const copyChanges = (files: FileChange[]): FileChange[] => files.map((file) => ({ ...file }));

/** The full ref names in `for-each-ref` output, one per line. */
const parseRefNames = (stdout: string): string[] =>
	stdout
		.split("\n")
		.map((ref) => ref.trim())
		.filter((ref) => ref.length > 0);

interface CachedTurnChanges {
	files: FileChange[];
	bytes: number;
}

interface CheckpointBaseDeps {
	git: GitRunner;
	checkpointerPath: string;
	/** Folder of the workspace a chat belongs to. */
	workspacePathOf: (sessionId: SessionId) => Promise<Result<string>>;
	/** Waits between checkpoint ref checks. Tests pass one that resolves at once. */
	sleep?: (ms: number) => Promise<void>;
}

/** Everything a revert needs: the chat's stored and in-memory event logs, and the clock. */
export interface CheckpointServiceDeps extends CheckpointBaseDeps {
	/** The chat's stored event log, so a revert marks later events in the same step. */
	events: Pick<SessionEventRepository, "markRevertedFromTurn">;
	/** Marks the open chat's in-memory events, so the turn list hides them without a reload. */
	markViewReverted: (sessionId: SessionId, turnId: TurnId, at: number) => void;
	/** Reads the "Also reset files" preference. */
	setting: <T>(key: string) => T;
	/**
	 * Repository reads for the archive prune. The composition root supplies them; when they are
	 * missing `pruneArchived` returns a clear error rather than guessing which chats to inspect.
	 */
	repositories?: () => Repositories;
	/** The current time in milliseconds. The revert and the archive prune both count from it. */
	now: () => number;
}

/** The subset the ref-pruning paths need. They never touch a chat's event log. */
export interface CheckpointPruneDeps extends CheckpointBaseDeps {
	/** Repository reads for the archive prune. */
	repositories?: () => Repositories;
	/** The current time in milliseconds. The archive prune counts 30 days from it. */
	now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

export class CheckpointService {
	readonly #deps: CheckpointServiceDeps | CheckpointPruneDeps;
	readonly #sleep: (ms: number) => Promise<void>;
	/** Turn change lists by chat and turn. Insertion order is the eviction order. */
	readonly #turnChanges = new Map<string, CachedTurnChanges>();
	#turnChangesBytes = 0;

	constructor(deps: CheckpointServiceDeps | CheckpointPruneDeps) {
		this.#deps = deps;
		this.#sleep = deps.sleep ?? defaultSleep;
	}

	/** True when the ref of this checkpoint exists in the workspace's repository. */
	async exists(sessionId: SessionId, checkpointId: string): Promise<Result<boolean>> {
		const folder = await this.#deps.workspacePathOf(sessionId);
		if (!folder.ok) return folder;
		return this.#refExists(folder.value, checkpointId);
	}

	/** Files a turn changed, from its start and end checkpoints. Backs the per-turn diff scope. */
	async changesForTurn(sessionId: SessionId, turnId: TurnId): Promise<Result<FileChange[]>> {
		const key = `${sessionId}:${turnId}`;
		const cached = this.#turnChanges.get(key);
		if (cached !== undefined) return ok(copyChanges(cached.files));

		const folder = await this.#deps.workspacePathOf(sessionId);
		if (!folder.ok) return folder;
		const cwd = folder.value;
		const startId = turnCheckpointId(sessionId, turnId, "start");
		const endId = turnCheckpointId(sessionId, turnId, "end");
		const ready = await this.#waitForTurnRefs(cwd, startId, endId);
		if (!ready.ok) return ready;

		const [nameStatus, numstat] = await Promise.all([
			this.#deps.git.runChecked(
				checkpointerDiff(this.#deps.checkpointerPath, startId, endId, ["--name-status"]),
				{ cwd },
			),
			this.#deps.git.runChecked(
				checkpointerDiff(this.#deps.checkpointerPath, startId, endId, ["--numstat"]),
				{ cwd },
			),
		]);
		if (!nameStatus.ok) return nameStatus;
		if (!numstat.ok) return numstat;

		const files = mergeChanges(
			parseNameStatus(nameStatus.value.stdout),
			parseNumstat(numstat.value.stdout),
		);
		this.#cacheTurnChanges(key, files);
		return ok(copyChanges(files));
	}

	/** Number of files that differ between a checkpoint and the working tree now. */
	async changedSince(sessionId: SessionId, checkpointId: string): Promise<Result<number>> {
		const folder = await this.#deps.workspacePathOf(sessionId);
		if (!folder.ok) return folder;
		const result = await this.#deps.git.runChecked(
			checkpointerDiff(this.#deps.checkpointerPath, checkpointId, "current", ["--name-only", "-z"]),
			{ cwd: folder.value },
		);
		if (!result.ok) return result;
		// NUL separators keep a path with a newline or a space in it as one name.
		const names = result.value.stdout.split("\0").filter((name) => name.length > 0);
		return ok(names.length);
	}

	async #refExists(cwd: string, checkpointId: string): Promise<Result<boolean>> {
		const result = await this.#deps.git.run(showRefVerify(checkpointRef(checkpointId)), { cwd });
		if (!result.ok) return result;
		if (result.value.exitCode === 0) return ok(true);
		if (result.value.exitCode === 1) return ok(false);
		return err(
			appError(
				"git_failed",
				result.value.stderr.trim() || `git show-ref exited with code ${result.value.exitCode}`,
			),
		);
	}

	/** Waits for both refs of a finished turn. The sidecar writes them just after the turn ends. */
	async #waitForTurnRefs(
		cwd: string,
		startId: string,
		endId: string,
	): Promise<Result<{ startId: string; endId: string }>> {
		const attempts = Math.ceil(CHECKPOINT_READY_TIMEOUT_MS / CHECKPOINT_READY_POLL_MS);
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			const start = await this.#refExists(cwd, startId);
			if (!start.ok) return start;
			if (start.value) {
				const end = await this.#refExists(cwd, endId);
				if (!end.ok) return end;
				if (end.value) return ok({ startId, endId });
			}
			if (attempt < attempts - 1) await this.#sleep(CHECKPOINT_READY_POLL_MS);
		}
		return err(appError("checkpoint_not_ready", "Checkpoint refs not ready"));
	}

	#cacheTurnChanges(key: string, files: FileChange[]): void {
		const previous = this.#turnChanges.get(key);
		if (previous !== undefined) {
			this.#turnChanges.delete(key);
			this.#turnChangesBytes -= previous.bytes;
		}
		const bytes = utf8.encode(JSON.stringify(files)).length;
		// One turn larger than the whole cache is returned to its caller but never stored.
		if (bytes > TURN_CHANGES_CACHE_BYTES) return;
		this.#turnChanges.set(key, { files, bytes });
		this.#turnChangesBytes += bytes;
		for (const [oldKey, entry] of this.#turnChanges) {
			if (this.#turnChangesBytes <= TURN_CHANGES_CACHE_BYTES) break;
			if (oldKey === key) break;
			this.#turnChanges.delete(oldKey);
			this.#turnChangesBytes -= entry.bytes;
		}
	}

	/**
	 * Removes all checkpoint refs of a chat that is being deleted. Returns how many were removed.
	 * Lists them with `forEachRefNames(sessionCheckpointRefPrefix(id))` and deletes each with
	 * `updateRefDelete`, under the repository lock. A second run finds nothing and returns zero.
	 */
	pruneForChat(sessionId: SessionId, repoRootPath: string): Promise<Result<number>> {
		return this.#withRepoLock(repoRootPath, async () => {
			const listed = await this.#deps.git.runChecked(
				forEachRefNames(sessionCheckpointRefPrefix(sessionId)),
				{ cwd: repoRootPath },
			);
			if (!listed.ok) return listed;
			const deleted = await this.#deleteRefs(repoRootPath, parseRefNames(listed.value.stdout));
			if (!deleted.ok) return deleted;
			this.#forgetTurnChanges(sessionId);
			return deleted;
		});
	}

	/**
	 * Removes checkpoint refs of chats whose workspace was archived more than `olderThanDays` ago.
	 * The cutoff is counted from `workspaces.archived_at`, so a later note or pin does not restart
	 * the clock. Runs from the startup checkpoint-pruning step.
	 */
	async pruneArchived(olderThanDays: number): Promise<Result<number>> {
		const repositories = this.#deps.repositories;
		const now = this.#deps.now;
		if (repositories === undefined || now === undefined) {
			return err(
				appError(
					"checkpoint_prune_unwired",
					"Checkpoint pruning is not wired to the database and clock.",
				),
			);
		}
		const cutoff = ageCutoff(now(), olderThanDays);
		const databases = repositories();
		const workspaces = await databases.workspaces.listByState("archived");
		if (!workspaces.ok) return workspaces;

		// One ref scan per repository, not one per chat: an old archive can hold many chats, and
		// this runs at every start.
		const byRepository = new Map<string, SessionId[]>();
		for (const workspace of workspaces.value) {
			if (workspace.archivedAt === null || workspace.archivedAt >= cutoff) continue;
			const repository = await databases.repos.get(workspace.repoId);
			if (!repository.ok) return repository;
			if (repository.value === null) {
				return err(
					appError("repo_unknown", "The project of an archived workspace no longer exists."),
				);
			}
			const sessions = await databases.sessions.listByWorkspace(workspace.id, {
				includeClosed: true,
			});
			if (!sessions.ok) return sessions;
			const existing = byRepository.get(repository.value.rootPath) ?? [];
			existing.push(...sessions.value.map((session) => session.id));
			byRepository.set(repository.value.rootPath, existing);
		}

		let removed = 0;
		for (const [repoRootPath, sessionIds] of byRepository) {
			const prefixes = sessionIds.map(sessionCheckpointRefPrefix);
			const deleted = await this.#withRepoLock(repoRootPath, async () => {
				const listed = await this.#deps.git.runChecked(forEachRefNames(CHECKPOINT_REF_PREFIX), {
					cwd: repoRootPath,
				});
				if (!listed.ok) return listed;
				const refs = parseRefNames(listed.value.stdout).filter((ref) =>
					prefixes.some((prefix) => ref.startsWith(prefix)),
				);
				return this.#deleteRefs(repoRootPath, refs);
			});
			if (!deleted.ok) return deleted;
			removed += deleted.value;
			for (const sessionId of sessionIds) this.#forgetTurnChanges(sessionId);
		}
		return ok(removed);
	}

	/**
	 * Holds the repository lock for a ref write. No worktree is left once a workspace is archived,
	 * so the repository root also stands in for the worktree key.
	 */
	#withRepoLock<T>(repoRootPath: string, work: () => Promise<T>): Promise<T> {
		return this.#deps.git.withWorktreeAndRepoLocks(repoRootPath, repoRootPath, work);
	}

	/** Deletes the given refs in one repository. The caller holds the repository lock. */
	async #deleteRefs(repoRootPath: string, refs: readonly string[]): Promise<Result<number>> {
		let removed = 0;
		for (const ref of refs) {
			const deleted = await this.#deps.git.runChecked(updateRefDelete(ref), {
				cwd: repoRootPath,
			});
			if (!deleted.ok) return deleted;
			removed += 1;
		}
		return ok(removed);
	}

	/** Drops the cached turn change lists of a chat whose refs are gone. */
	#forgetTurnChanges(sessionId: SessionId): void {
		const prefix = `${sessionId}:`;
		for (const [key, entry] of this.#turnChanges) {
			if (!key.startsWith(prefix)) continue;
			this.#turnChanges.delete(key);
			this.#turnChangesBytes -= entry.bytes;
		}
	}

	/**
	 * Backs `Actions.sessions.revertTo`. Restores the turn's start checkpoint when the preference
	 * asks for files too, then marks every event from the turn onward as reverted. A turn without a
	 * start checkpoint is refused before anything changes.
	 */
	async revertTo(sessionId: SessionId, turnId: TurnId): Promise<Result<void>> {
		const deps = this.#deps;
		if (!("events" in deps)) {
			return err(
				appError("checkpoint_unwired", "Reverting a chat is not wired to the chat store."),
			);
		}
		const { events, markViewReverted, setting, now } = deps;

		const folder = await deps.workspacePathOf(sessionId);
		if (!folder.ok) return folder;
		const cwd = folder.value;
		const startId = turnCheckpointId(sessionId, turnId, "start");

		const present = await this.#refExists(cwd, startId);
		if (!present.ok) return present;
		if (!present.value) return err(appError("checkpoint_missing", CHECKPOINT_MISSING_MESSAGE));

		if (setting<boolean>("reset_chat_also_reset_files")) {
			const restored = await this.#deps.git.withWorktreeLock(cwd, () =>
				this.#deps.git.run(checkpointerRestore(this.#deps.checkpointerPath, startId), { cwd }),
			);
			if (!restored.ok) {
				return err(appError("checkpoint_restore_failed", REVERT_FAILED_MESSAGE, restored.error));
			}
			if (restored.value.exitCode !== 0 || restored.value.stderr.trim().length > 0) {
				return err(appError("checkpoint_restore_failed", REVERT_FAILED_MESSAGE, restored.value));
			}
		}

		const at = now();
		const marked = await events.markRevertedFromTurn(sessionId, turnId, at);
		if (!marked.ok) return marked;
		markViewReverted(sessionId, turnId, at);
		return ok(undefined);
	}

	/** Backs `Actions.sessions.forkFrom`. */
	forkFrom(_sessionId: SessionId, _turnId: TurnId): Promise<Result<Session>> {
		return notImplemented("CHAT-16");
	}

	/** Backs `Actions.sessions.forkToWorkspace`. */
	forkToWorkspace(_sessionId: SessionId, _turnId: TurnId): Promise<Result<Workspace>> {
		return notImplemented("CHAT-21");
	}
}
