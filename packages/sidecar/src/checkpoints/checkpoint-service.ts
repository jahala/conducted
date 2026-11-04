/**
 * @feature SIDE-08 Checkpoints: start before first write, end with file summary
 * Owns: taking the start and end checkpoint of a turn by calling bin/checkpointer.sh, and turning
 * the result into the data of a checkpoint event.
 * Behaviour: research/conductor/sessions.md section 7 "Checkpoints": the script runs in the
 * workspace folder with a 60 s timeout (SIGTERM, then SIGKILL 5 s later); a start checkpoint is
 * taken before the runner is called and the agent's first file-changing tool waits for it; an end
 * checkpoint is taken on success, on failure and on cancel; a skipped or failed checkpoint still
 * produces an event without a checkpoint id; shutdown takes none.
 * Must handle:
 *  - the script path comes from config (binDir); a missing script is a failed checkpoint with a
 *    clear reason, logged once, not a crash
 *  - the start checkpoint is a promise handed to the runner (TurnCallbacks.beforeFirstWrite
 *    awaits it); it must never reject, failures resolve to a skipped outcome
 *  - the end checkpoint waits for the start checkpoint of the same turn
 *  - the next turn waits for the previous end checkpoint (the manager awaits settled())
 *  - cancel during a running checkpoint: the script is allowed to finish or hit its timeout
 *  - the same id twice (a retry): the script gets --force, as Conductor does
 *  - the diff summary: two `diff` calls (--name-status -z and --numstat -z), omitted above 200
 *    files; a failing diff call leaves the changes out and keeps the checkpoint id
 * Test first: exit code 101 from the process runner gives an outcome with skippedReason
 * merge_in_progress and no checkpoint id.
 * Our design choice: the process runner is a parameter, so tests run the real script against a
 * temp repository only in the script's own test, and this class is tested with a recording runner.
 */
import type { FileChange } from "@conducted/protocol";
import type { CheckpointId, SessionId, TurnId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { SkipReason } from "./checkpoint-id.ts";

/** Time the script may run before SIGTERM. From the research. */
export const CHECKPOINT_TIMEOUT_MS = 60_000;
/** Time between SIGTERM and SIGKILL. From the research. */
export const CHECKPOINT_KILL_GRACE_MS = 5_000;

export interface CheckpointOutcome {
	checkpointId?: CheckpointId;
	skippedReason?: SkipReason;
	/** End checkpoints only. Undefined when the diff was too large or could not be computed. */
	changes?: FileChange[];
}

/** Runs the script and returns its exit code and stdout. A parameter so tests need no processes. */
export type RunCheckpointer = (
	args: readonly string[],
	options: { cwd: string; timeoutMs: number; killGraceMs: number },
) => Promise<{ exitCode: number; stdout: string }>;

export interface CheckpointService {
	/** Never rejects. Resolves to a skipped outcome on any failure. */
	start(request: CheckpointRequest): Promise<CheckpointOutcome>;
	/** Waits for the start checkpoint of the same turn, then takes the end one with a file summary. */
	end(request: CheckpointRequest): Promise<CheckpointOutcome>;
}

export interface CheckpointRequest {
	sessionId: SessionId;
	turnId: TurnId;
	workspacePath: string;
}

export class ScriptCheckpointService implements CheckpointService {
	constructor(
		protected readonly deps: {
			/** Absolute path of bin/checkpointer.sh. */
			scriptPath: string;
			run: RunCheckpointer;
			logger: Logger;
		},
	) {}

	start(_request: CheckpointRequest): Promise<CheckpointOutcome> {
		return notImplemented("SIDE-08");
	}

	end(_request: CheckpointRequest): Promise<CheckpointOutcome> {
		return notImplemented("SIDE-08");
	}
}
