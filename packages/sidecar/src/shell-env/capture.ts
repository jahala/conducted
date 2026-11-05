/**
 * @feature SIDE-10 Login-shell environment capture
 * Owns: running the user's login shell once to learn its PATH and environment, caching the result,
 * and serving it to runners and to the getShellEnv request.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 "Shell env capture" (zsh and bash with
 * -ilc, fish with -i -l -c, fallback `zsh -lc`, timeouts 5 s and 3 s) and A6 step 11 (the app
 * repairs PATH from the login shell so `claude`, `codex` and `gh` resolve). services-map 5A.8.3:
 * the cache is keyed by folder and a failure sends `shellEnvFailed` with the folder, a kind and the
 * message. The kind is timeout, shell_not_found or unknown.
 * Must handle:
 *  - the shell hangs or prints a prompt: kill it at the timeout and try the fallback
 *  - both attempts fail: return an error value and notify once; the caller decides (no silent
 *    default PATH), and the failed entry is dropped so the next call retries
 *  - two callers at once for the same folder: share one capture (single flight)
 *  - two folders at once: capture each on its own, because direnv and mise change PATH per folder
 *  - refresh(): re-run on demand, because the user may install a tool and change their profile
 *  - fish and other shells use their own flag spelling (see captureCommandFor)
 * Test first: captureCommandFor("/bin/zsh") returns the -ilc form and a marker around `env -0`.
 * Our design choice: the process runner is a parameter (SpawnText), so tests never start a real
 * shell and production passes Bun.spawn.
 * Our design choice: the folder is baked into the capture script as `cd '<folder>'` rather than
 * passed through the spawn port. The shell is the only part both the Rust and sidecar captures
 * share, and the port stays unchanged. The Rust capture uses `cd "$CONDUCTED_CWD"` to reach the
 * same result (apps/desktop/src-tauri/src/shell.rs).
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

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function captureScript(marker: string, folder?: string): string {
	const dump = `printf '%s' '${marker}'; env -0; printf '%s' '${marker}'`;
	if (folder === undefined) return dump;
	return `cd ${shellQuote(folder)} || exit 1; ${dump}`;
}

/** The login-shell command that prints the environment between two markers. */
export function captureCommandFor(
	shellPath: string,
	marker: string,
	folder?: string,
): CaptureCommand {
	const script = captureScript(marker, folder);
	const name = shellName(shellPath);
	if (name === "fish") return { command: shellPath, args: ["-i", "-l", "-c", script] };
	if (name === "zsh" || name === "bash") return { command: shellPath, args: ["-ilc", script] };
	return fallbackCaptureCommand(marker, folder);
}

/** The fallback when the primary attempt fails: a plain login zsh. */
export function fallbackCaptureCommand(marker: string, folder?: string): CaptureCommand {
	return {
		command: FALLBACK_SHELL,
		args: ["-lc", captureScript(marker, folder)],
	};
}

/** Why a capture failed, as the app's toast expects it (services-map 5A.8.3). */
export type ShellEnvFailureKind = "timeout" | "shell_not_found" | "unknown";

export interface ShellEnvFailure {
	folder: string;
	kind: ShellEnvFailureKind;
	message: string;
}

/** Sends `shellEnvFailed`. The composition root connects it to the app's notifier. */
export type NotifyShellEnvFailure = (failure: ShellEnvFailure) => void;

/** Maps the error value from a failed attempt onto the notification's kind. */
export function classifyShellEnvFailure(error: AppError): ShellEnvFailureKind {
	const code = error.code.toLowerCase();
	if (code.includes("timeout") || /\btimed? ?out\b/i.test(error.message)) return "timeout";
	if (
		code === "shell_not_found" ||
		code === "spawn_failed" ||
		/ENOENT|no such file|\bnot found\b/i.test(error.message)
	) {
		return "shell_not_found";
	}
	return "unknown";
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
	/** The cached capture for a folder, or a fresh one on first use. */
	get(folder?: string): Promise<Result<CapturedShellEnv, AppError>>;
	/** Captures that folder again and replaces its cache entry. */
	refresh(folder?: string): Promise<Result<CapturedShellEnv, AppError>>;
}

export class LoginShellEnvProvider implements ShellEnvProvider {
	private readonly cached = new Map<string, CapturedShellEnv>();
	private readonly inFlight = new Map<string, Promise<Result<CapturedShellEnv, AppError>>>();

	constructor(
		protected readonly deps: {
			spawnText: SpawnText;
			/** The user's shell, for example the SHELL variable of the sidecar process. */
			shellPath: string;
			/** A fresh random marker per capture, from IdSource. */
			newMarker: () => string;
			logger: Logger;
			/** Sends `shellEnvFailed`. Absent in tests that do not check the toast. */
			notifyFailure?: NotifyShellEnvFailure;
		},
	) {}

	get(folder: string = process.cwd()): Promise<Result<CapturedShellEnv, AppError>> {
		const hit = this.cached.get(folder);
		if (hit !== undefined) return Promise.resolve(ok(hit));
		return this.captureOnce(folder);
	}

	/** Captures again and replaces the cache. A failure leaves no cache behind, so the next call retries. */
	refresh(folder: string = process.cwd()): Promise<Result<CapturedShellEnv, AppError>> {
		this.cached.delete(folder);
		return this.captureOnce(folder);
	}

	/** Two callers at once for one folder share a capture, so its login shell is started only once. */
	private captureOnce(folder: string): Promise<Result<CapturedShellEnv, AppError>> {
		const running = this.inFlight.get(folder);
		if (running !== undefined) return running;
		const run = this.capture(folder).then((result) => {
			if (result.ok) this.cached.set(folder, result.value);
			return result;
		});
		const settled = run.finally(() => {
			if (this.inFlight.get(folder) === settled) this.inFlight.delete(folder);
		});
		this.inFlight.set(folder, settled);
		return settled;
	}

	private async capture(folder: string): Promise<Result<CapturedShellEnv, AppError>> {
		if (KNOWN_SHELLS.has(shellName(this.deps.shellPath))) {
			const primary = await this.attempt(
				this.deps.shellPath,
				folder,
				PRIMARY_CAPTURE_TIMEOUT_MS,
				(marker) => captureCommandFor(this.deps.shellPath, marker, folder),
			);
			if (primary.ok) return primary;
			this.deps.logger.warn("The login shell could not be captured; trying the fallback", {
				code: primary.error.code,
			});
		}

		const fallback = await this.attempt(
			FALLBACK_SHELL,
			folder,
			FALLBACK_CAPTURE_TIMEOUT_MS,
			(marker) => fallbackCaptureCommand(marker, folder),
		);
		if (!fallback.ok) {
			this.deps.logger.error("Could not capture the login-shell environment", {
				code: fallback.error.code,
				message: fallback.error.message,
			});
			this.deps.notifyFailure?.({
				folder,
				kind: classifyShellEnvFailure(fallback.error),
				message: fallback.error.message,
			});
		}
		return fallback;
	}

	private async attempt(
		shell: string,
		folder: string,
		timeoutMs: number,
		command: (marker: string) => CaptureCommand,
	): Promise<Result<CapturedShellEnv, AppError>> {
		const marker = this.deps.newMarker();
		const spawned = await this.deps.spawnText(command(marker), { timeoutMs });
		if (!spawned.ok) return spawned;
		const parsed = parseEnvDump(spawned.value, marker);
		if (!parsed.ok) return parsed;
		const env = stripProviderSecrets(parsed.value);
		this.deps.logger.debug("Captured the login-shell environment", { shell, folder });
		return ok({ shell, path: env.PATH ?? "", env });
	}
}
