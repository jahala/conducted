/**
 * @feature CHAT-15 Checkpoints: per-turn changes, revert and fork; REV-09 Turn changes from checkpoints
 * Owns: reading the private checkpoint refs that the sidecar writes around each turn, listing
 * what a turn changed, counting files that changed since a checkpoint, and restoring the working
 * tree to a turn's start.
 * Behaviour: services-map.md 3.12 (checkpoint ids, `checkpointer.sh` subcommands, frontend uses),
 * sessions-and-chats.md "Checkpoints, revert, fork and archive", sessions.md 7 (when
 * checkpoints are taken; skipped on merge, rebase or conflicts).
 * Must handle: a turn with no start checkpoint (the chat gave no restore point: revert and fork
 * are disabled with a reason); refs that are not written yet when the turn just ended (wait a
 * short time, then say "not ready"); more than 200 changed files (the end event omits the list,
 * so compute it from the refs, capped); restoring needs a clean git state (exit 101 and 102 are
 * explained, not retried); revert marks later events as reverted in the same step, and says
 * "No changes or conversation history have been reverted" when restore fails; fork starts a new
 * chat whose agent resumes the old history only up to the chosen turn; the original chat is
 * untouched; refs are removed only by the two prune methods (when a chat is deleted, and 30 days
 * after its workspace was archived), never by revert or fork; pruning one chat never touches
 * another chat's refs, even when ids share a prefix.
 * The per-turn change list is read with the checkpointer's own diff, so it includes untracked
 * files and honours the repository's ignore rules like the checkpoint itself. It is cached per
 * chat and turn; every caller gets its own copy of the list, so one caller's change cannot reach
 * the cache. The cache holds at most 5 MB and evicts the oldest turns first.
 * Our design choice: a revert restores files and hides later events in one user action, and asks
 * the sidecar to reset the agent so its next turn resumes from the chosen message.
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
import { checkpointerDiff, showRefVerify } from "../git/commands.ts";
import { checkpointRef, turnCheckpointId } from "../git/refs.ts";
import type { GitRunner } from "../git/runner.ts";
import { mergeChanges, parseNameStatus, parseNumstat } from "../git/status.ts";
import type { Session, Workspace } from "../model.ts";

/** How long a finished turn's change list waits for its two checkpoint refs. */
export const CHECKPOINT_READY_TIMEOUT_MS = 2_000;
/** How long each wait between ref checks lasts. */
export const CHECKPOINT_READY_POLL_MS = 50;
/** Most memory the per-turn change list cache may hold (services-map 3.12.3). */
export const TURN_CHANGES_CACHE_BYTES = 5 * 1024 * 1024;

const utf8 = new TextEncoder();

/** A caller's own copy, so changing a result never reaches the cache. */
const copyChanges = (files: FileChange[]): FileChange[] => files.map((file) => ({ ...file }));

interface CachedTurnChanges {
	files: FileChange[];
	bytes: number;
}

export interface CheckpointServiceDeps {
	git: GitRunner;
	checkpointerPath: string;
	/** Folder of the workspace a chat belongs to. */
	workspacePathOf: (sessionId: SessionId) => Promise<Result<string>>;
	/** Waits between checkpoint ref checks. Tests pass one that resolves at once. */
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

export class CheckpointService {
	readonly #deps: CheckpointServiceDeps;
	readonly #sleep: (ms: number) => Promise<void>;
	/** Turn change lists by chat and turn. Insertion order is the eviction order. */
	readonly #turnChanges = new Map<string, CachedTurnChanges>();
	#turnChangesBytes = 0;

	constructor(deps: CheckpointServiceDeps) {
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
	 * `updateRefDelete`, under the repository lock.
	 */
	pruneForChat(_sessionId: SessionId, _repoRootPath: string): Promise<Result<number>> {
		return notImplemented("DATA-06");
	}

	/**
	 * Removes checkpoint refs of chats whose workspace was archived more than `olderThanDays` ago
	 * (30 by default, from the data-lifetime limits). Runs from the data-lifetime job.
	 */
	pruneArchived(_olderThanDays: number): Promise<Result<number>> {
		return notImplemented("DATA-06");
	}

	/** Backs `Actions.sessions.revertTo`. */
	revertTo(_sessionId: SessionId, _turnId: TurnId): Promise<Result<void>> {
		return notImplemented("CHAT-15");
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
