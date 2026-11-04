/**
 * @feature SIDE-10 Login-shell environment capture
 * Owns: running the user's login shell once to learn its PATH and environment, caching the result,
 * and serving it to runners and to the getShellEnv request.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 "Shell env capture" (zsh and bash with
 * -ilc, fish with -i -l -c, fallback `zsh -lc`, timeouts 5 s and 3 s) and A6 step 11 (the app
 * repairs PATH from the login shell so `claude`, `codex` and `gh` resolve).
 * Must handle:
 *  - the shell hangs or prints a prompt: kill it at the timeout and try the fallback
 *  - both attempts fail: return an error value; the caller decides (no silent default PATH)
 *  - two callers at once: share one capture (single flight)
 *  - refresh(): re-run on demand, because the user may install a tool and change their profile
 *  - fish and other shells use their own flag spelling (see captureCommandFor)
 * Test first: captureCommandFor("/bin/zsh") returns the -ilc form and a marker around `env -0`.
 * Our design choice: the process runner is a parameter (SpawnText), so tests never start a real
 * shell and production passes Bun.spawn.
 */
import type { AppError, Result } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";

export const PRIMARY_CAPTURE_TIMEOUT_MS = 5_000;
export const FALLBACK_CAPTURE_TIMEOUT_MS = 3_000;

export interface CaptureCommand {
	command: string;
	args: string[];
}

/** The login-shell command that prints the environment between two markers. */
export function captureCommandFor(shellPath: string, marker: string): CaptureCommand {
	const script = `printf '%s' '${marker}'; env -0; printf '%s' '${marker}'`;
	const name = shellPath.split("/").pop() ?? shellPath;
	if (name === "fish") return { command: shellPath, args: ["-i", "-l", "-c", script] };
	return { command: shellPath, args: ["-ilc", script] };
}

/** The fallback when the primary attempt fails: a plain login zsh. */
export function fallbackCaptureCommand(marker: string): CaptureCommand {
	return {
		command: "/bin/zsh",
		args: ["-lc", `printf '%s' '${marker}'; env -0; printf '%s' '${marker}'`],
	};
}

/** Runs a command and returns its stdout. Provided by the caller. */
export type SpawnText = (
	command: CaptureCommand,
	options: { timeoutMs: number },
) => Promise<Result<string, AppError>>;

export interface CapturedShellEnv {
	shell: string;
	path: string;
	/** The captured variables with provider secrets already removed. */
	env: Readonly<Record<string, string>>;
}

export interface ShellEnvProvider {
	/** The cached capture, or a fresh one on first use. */
	get(): Promise<Result<CapturedShellEnv, AppError>>;
	/** Captures again and replaces the cache. */
	refresh(): Promise<Result<CapturedShellEnv, AppError>>;
}

export class LoginShellEnvProvider implements ShellEnvProvider {
	constructor(
		protected readonly deps: {
			spawnText: SpawnText;
			/** The user's shell, for example the SHELL variable of the sidecar process. */
			shellPath: string;
			/** A fresh random marker per capture, from IdSource. */
			newMarker: () => string;
			logger: Logger;
		},
	) {}

	get(): Promise<Result<CapturedShellEnv, AppError>> {
		return notImplemented("SIDE-10");
	}

	refresh(): Promise<Result<CapturedShellEnv, AppError>> {
		return notImplemented("SIDE-10");
	}
}
