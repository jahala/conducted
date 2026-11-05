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
 *  - the next turn waits for the previous end checkpoint: Turn.start awaits the previous turn's
 *    settled promise, not this class
 *  - cancel during a running checkpoint: the script is allowed to finish or hit its timeout
 *  - every save passes --force, as Conductor does, so a repeated id overwrites instead of failing
 *  - the diff summary: two `diff` calls (--name-status -z and --numstat -z) run together, omitted
 *    above 200 files; a failing diff call leaves the changes out and keeps the checkpoint id
 *  - the log line keeps at most 64 KiB of the script's output and error
 * Test first: exit code 101 from the process runner gives an outcome with skippedReason
 * merge_in_progress and no checkpoint id.
 * Our design choice: the process runner is a parameter, so tests run the real script against a
 * temp repository only in the script's own test, and this class is tested with a recording runner.
 * Our design choice: when the start checkpoint is skipped there is nothing to diff against, so the
 * end checkpoint still carries its id but no `changes`. sessions.md section 7 only says the summary
 * compares the start and end ids.
 * Lifetime: `turns` holds one record from the start checkpoint until the end checkpoint settles;
 * `end()` removes it. A turn whose end never runs (shutdown takes none, by design) keeps its record
 * until the sidecar process exits. That is the only bound, and it matches the research.
 */
import type { FileChange } from "@conducted/protocol";
import type { CheckpointId, SessionId, TurnId } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { messageOf } from "../util/errors.ts";
import {
	type CheckpointPhase,
	checkpointIdFor,
	checkpointRefFor,
	exitCodeToOutcome,
	type SkipReason,
} from "./checkpoint-id.ts";
import { capSummary, parseDiffSummary } from "./diff-summary.ts";

/** Time the script may run before SIGTERM. From the research. */
export const CHECKPOINT_TIMEOUT_MS = 60_000;
/** Time between SIGTERM and SIGKILL. From the research. */
export const CHECKPOINT_KILL_GRACE_MS = 5_000;
/** Most of the script's output and error kept for the log line. */
export const MAX_LOG_LENGTH = 64 * 1024;

export interface CheckpointOutcome {
	checkpointId?: CheckpointId;
	skippedReason?: SkipReason;
	/** End checkpoints only. Undefined when the diff was too large or could not be computed. */
	changes?: FileChange[];
}

export interface CheckpointerOutput {
	exitCode: number;
	stdout: string;
	/** Kept for the log line when the runner captures it. */
	stderr?: string;
	/** True when stdout or stderr was longer than the log line keeps and the rest was dropped. */
	truncated?: boolean;
}

/** Runs the script and returns its exit code and stdout. A parameter so tests need no processes. */
export type RunCheckpointer = (
	args: readonly string[],
	options: { cwd: string; timeoutMs: number; killGraceMs: number },
) => Promise<CheckpointerOutput>;

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

interface TurnCheckpoints {
	start: Promise<CheckpointOutcome>;
	end: Promise<CheckpointOutcome> | null;
}

function turnKey(request: CheckpointRequest): string {
	return JSON.stringify([request.sessionId, request.turnId]);
}

function keepForLog(text: string): string {
	return text.length > MAX_LOG_LENGTH ? text.slice(0, MAX_LOG_LENGTH) : text;
}

export class ScriptCheckpointService implements CheckpointService {
	private readonly turns = new Map<string, TurnCheckpoints>();
	private runFailureLogged = false;

	constructor(
		protected readonly deps: {
			/** Absolute path of bin/checkpointer.sh. */
			scriptPath: string;
			run: RunCheckpointer;
			logger: Logger;
		},
	) {}

	start(request: CheckpointRequest): Promise<CheckpointOutcome> {
		const key = turnKey(request);
		const existing = this.turns.get(key);
		if (existing !== undefined) return existing.start;

		const record: TurnCheckpoints = { start: this.take(request, "start"), end: null };
		this.turns.set(key, record);
		return record.start;
	}

	end(request: CheckpointRequest): Promise<CheckpointOutcome> {
		const key = turnKey(request);
		const existing = this.turns.get(key);
		if (existing !== undefined && existing.end !== null) return existing.end;

		const start = existing?.start ?? Promise.resolve<CheckpointOutcome>({});
		const end = this.takeEnd(request, start);
		const record: TurnCheckpoints = { start, end };
		this.turns.set(key, record);
		void end.finally(() => {
			if (this.turns.get(key) === record) this.turns.delete(key);
		});
		return end;
	}

	private async take(
		request: CheckpointRequest,
		phase: CheckpointPhase,
	): Promise<CheckpointOutcome> {
		const id = checkpointIdFor(request.sessionId, request.turnId, phase);
		if (id === null) {
			this.deps.logger.warn("A checkpoint id is not a safe git ref name, so it was skipped", {
				sessionId: request.sessionId,
				turnId: request.turnId,
				phase,
			});
			return { skippedReason: "failed" };
		}

		const output = await this.save(request.workspacePath, id);
		if (output === null) return { skippedReason: "failed" };

		const outcome = exitCodeToOutcome(output.exitCode);
		if (outcome.kind === "created") {
			this.deps.logger.debug("Checkpoint created", {
				sessionId: request.sessionId,
				turnId: request.turnId,
				phase,
				checkpointId: id,
				ref: checkpointRefFor(id),
			});
			return { checkpointId: id };
		}

		this.deps.logger.warn("Checkpoint skipped", {
			sessionId: request.sessionId,
			turnId: request.turnId,
			phase,
			exitCode: output.exitCode,
			reason: outcome.reason,
			detail: outcome.detail,
			output: keepForLog(output.stdout),
			...(output.stderr === undefined ? {} : { error: keepForLog(output.stderr) }),
		});
		return { skippedReason: outcome.reason };
	}

	private async takeEnd(
		request: CheckpointRequest,
		start: Promise<CheckpointOutcome>,
	): Promise<CheckpointOutcome> {
		let startOutcome: CheckpointOutcome;
		try {
			startOutcome = await start;
		} catch {
			startOutcome = { skippedReason: "failed" };
		}

		const outcome = await this.take(request, "end");
		if (outcome.checkpointId === undefined || startOutcome.checkpointId === undefined) {
			return outcome;
		}

		const changes = await this.summarize(
			request.workspacePath,
			startOutcome.checkpointId,
			outcome.checkpointId,
		);
		return changes === undefined ? outcome : { ...outcome, changes };
	}

	private async save(workspacePath: string, id: CheckpointId): Promise<CheckpointerOutput | null> {
		try {
			return await this.deps.run(["save", "--id", id, "--force"], {
				cwd: workspacePath,
				timeoutMs: CHECKPOINT_TIMEOUT_MS,
				killGraceMs: CHECKPOINT_KILL_GRACE_MS,
			});
		} catch (cause) {
			this.logRunFailure(workspacePath, cause);
			return null;
		}
	}

	private async summarize(
		workspacePath: string,
		startId: CheckpointId,
		endId: CheckpointId,
	): Promise<FileChange[] | undefined> {
		const options = {
			cwd: workspacePath,
			timeoutMs: CHECKPOINT_TIMEOUT_MS,
			killGraceMs: CHECKPOINT_KILL_GRACE_MS,
		};
		try {
			const [nameStatus, numstat] = await Promise.all([
				this.deps.run(["diff", startId, endId, "--", "--name-status", "-z"], options),
				this.deps.run(["diff", startId, endId, "--", "--numstat", "-z"], options),
			]);
			if (nameStatus.truncated === true || numstat.truncated === true) {
				// A cut stream would parse into a partial list that looks complete.
				this.deps.logger.warn("The turn diff summary was left out: the script output was cut", {
					startId,
					endId,
				});
				return undefined;
			}
			if (nameStatus.exitCode !== 0 || numstat.exitCode !== 0) {
				this.deps.logger.warn("The turn diff summary could not be computed", {
					startId,
					endId,
					nameStatusExitCode: nameStatus.exitCode,
					numstatExitCode: numstat.exitCode,
					output: keepForLog(nameStatus.stdout),
					error: keepForLog(nameStatus.stderr ?? numstat.stderr ?? ""),
				});
				return undefined;
			}
			return capSummary(parseDiffSummary(nameStatus.stdout, numstat.stdout));
		} catch (cause) {
			this.deps.logger.warn("The turn diff summary could not be computed", {
				startId,
				endId,
				reason: messageOf(cause),
			});
			return undefined;
		}
	}

	private logRunFailure(workspacePath: string, cause: unknown): void {
		if (this.runFailureLogged) {
			this.deps.logger.debug("The checkpointer could not be started again", {
				cwd: workspacePath,
				reason: messageOf(cause),
			});
			return;
		}
		this.runFailureLogged = true;
		this.deps.logger.warn("The checkpointer could not be started, so checkpoints are skipped", {
			cwd: workspacePath,
			scriptPath: this.deps.scriptPath,
			reason: messageOf(cause),
		});
	}
}
