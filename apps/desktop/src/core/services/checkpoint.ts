/**
 * @feature CHAT-15 Checkpoints: per-turn changes, revert and fork
 * Owns: reading the private checkpoint refs that the sidecar writes around each turn, listing
 * what a turn changed, and restoring the working tree to a turn's start.
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
 * Our design choice: a revert restores files and hides later events in one user action, and asks
 * the sidecar to reset the agent so its next turn resumes from the chosen message.
 * Test first: reverting to a turn without a start checkpoint returns an Err and changes nothing.
 */
import type { FileChange } from "@conducted/protocol";
import { notImplemented, type Result, type SessionId, type TurnId } from "@conducted/shared";
import type { GitRunner } from "../git/runner.ts";
import type { Session, Workspace } from "../model.ts";

export interface CheckpointServiceDeps {
	git: GitRunner;
	checkpointerPath: string;
	/** Folder of the workspace a chat belongs to. */
	workspacePathOf: (sessionId: SessionId) => Promise<Result<string>>;
}

export class CheckpointService {
	readonly #deps: CheckpointServiceDeps;

	constructor(deps: CheckpointServiceDeps) {
		this.#deps = deps;
	}

	/** True when the ref of this checkpoint exists in the workspace's repository. */
	exists(_sessionId: SessionId, _checkpointId: string): Promise<Result<boolean>> {
		void this.#deps;
		return notImplemented("REV-09");
	}

	/** Files a turn changed, from its start and end checkpoints. Backs the per-turn diff scope. */
	changesForTurn(_sessionId: SessionId, _turnId: TurnId): Promise<Result<FileChange[]>> {
		return notImplemented("REV-09");
	}

	/** Number of files that differ between a checkpoint and the working tree now. */
	changedSince(_sessionId: SessionId, _checkpointId: string): Promise<Result<number>> {
		return notImplemented("REV-09");
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
