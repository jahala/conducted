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
import { ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { parseEnvDump, stripProviderSecrets } from "./env.ts";

export const PRIMARY_CAPTURE_TIMEOUT_MS = 5_000;
export const FALLBACK_CAPTURE_TIMEOUT_MS = 3_000;

/** The plain login shell used when the user's shell is unknown or the first attempt fails. */
export const FALLBACK_SHELL = "/bin/zsh";

/** Shells whose flags are known, so the first attempt may use them. */
const KNOWN_SHELLS = new Set(["zsh", "bash", "fish"]);

export interface CaptureCommand {
	command: string;
	args: string[];
}

function shellName(shellPath: string): string {
	return shellPath.split("/").pop() ?? shellPath;
}

function captureScript(marker: string): string {
	return `printf '%s' '${marker}'; env -0; printf '%s' '${marker}'`;
}

/** The login-shell command that prints the environment between two markers. */
export function captureCommandFor(shellPath: string, marker: string): CaptureCommand {
	const script = captureScript(marker);
	const name = shellName(shellPath);
	if (name === "fish") return { command: shellPath, args: ["-i", "-l", "-c", script] };
	if (name === "zsh" || name === "bash") return { command: shellPath, args: ["-ilc", script] };
	return fallbackCaptureCommand(marker);
}

/** The fallback when the primary attempt fails: a plain login zsh. */
export function fallbackCaptureCommand(marker: string): CaptureCommand {
	return {
		command: FALLBACK_SHELL,
		args: ["-lc", captureScript(marker)],
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
	private cached: CapturedShellEnv | undefined;
	private inFlight: Promise<Result<CapturedShellEnv, AppError>> | undefined;

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
		if (this.cached !== undefined) return Promise.resolve(ok(this.cached));
		return this.captureOnce();
	}

	/** Captures again and replaces the cache. A failure leaves no cache behind, so the next call retries. */
	refresh(): Promise<Result<CapturedShellEnv, AppError>> {
		this.cached = undefined;
		return this.captureOnce();
	}

	/** Two callers at once share one capture, so a slow login shell is started only once. */
	private captureOnce(): Promise<Result<CapturedShellEnv, AppError>> {
		if (this.inFlight !== undefined) return this.inFlight;
		const run = this.capture().then((result) => {
			if (result.ok) this.cached = result.value;
			return result;
		});
		const settled = run.finally(() => {
			if (this.inFlight === settled) this.inFlight = undefined;
		});
		this.inFlight = settled;
		return settled;
	}

	private async capture(): Promise<Result<CapturedShellEnv, AppError>> {
		if (KNOWN_SHELLS.has(shellName(this.deps.shellPath))) {
			const primary = await this.attempt(
				this.deps.shellPath,
				PRIMARY_CAPTURE_TIMEOUT_MS,
				(marker) => captureCommandFor(this.deps.shellPath, marker),
			);
			if (primary.ok) return primary;
			this.deps.logger.warn("The login shell could not be captured; trying the fallback", {
				code: primary.error.code,
			});
		}

		const fallback = await this.attempt(FALLBACK_SHELL, FALLBACK_CAPTURE_TIMEOUT_MS, (marker) =>
			fallbackCaptureCommand(marker),
		);
		if (!fallback.ok) {
			this.deps.logger.error("Could not capture the login-shell environment", {
				code: fallback.error.code,
				message: fallback.error.message,
			});
		}
		return fallback;
	}

	private async attempt(
		shell: string,
		timeoutMs: number,
		command: (marker: string) => CaptureCommand,
	): Promise<Result<CapturedShellEnv, AppError>> {
		const marker = this.deps.newMarker();
		const spawned = await this.deps.spawnText(command(marker), { timeoutMs });
		if (!spawned.ok) return spawned;
		const parsed = parseEnvDump(spawned.value, marker);
		if (!parsed.ok) return parsed;
		const env = stripProviderSecrets(parsed.value);
		this.deps.logger.debug("Captured the login-shell environment", { shell });
		return ok({ shell, path: env.PATH ?? "", env });
	}
}
