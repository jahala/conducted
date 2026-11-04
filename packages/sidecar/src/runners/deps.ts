/**
 * @feature AGENT-01 The runner contract: shared runner dependencies
 * Owns: the ports every runner receives (probing a program, finding it on PATH, waiting) so no
 * runner reads process.env, spawns by itself or sleeps with a global timer.
 * Behaviour: research/conductor/other-runners.md section 6 (per-harness env and launch are the part
 * that differs; the rest is shared) and docs/plans/scaffold.md decision 7 (agent programs are
 * found on the captured login-shell PATH).
 * Must handle: nothing at runtime; this file declares types.
 * Test first: none (types only).
 */
import type { AppError, Clock, IdSource, Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";

/** Runs a short command and returns its output. Used for `--version` and auth status probes. */
export type ProbeCommand = (
	command: string,
	args: readonly string[],
	options: { env: Readonly<Record<string, string>>; cwd?: string; timeoutMs: number },
) => Promise<Result<{ stdout: string; stderr: string; exitCode: number }, AppError>>;

/** Finds an executable by name on the PATH in `env`. Returns its absolute path or null. */
export type FindExecutable = (
	name: string,
	env: Readonly<Record<string, string>>,
) => Promise<string | null>;

export interface RunnerCommonDeps {
	logger: Logger;
	clock: Clock;
	ids: IdSource;
	probe: ProbeCommand;
	findExecutable: FindExecutable;
}
