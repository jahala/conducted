/**
 * @feature SIDE-01 Entry point and modes
 * Owns: reading the sidecar and logger startup settings from the environment the Rust shell sets, and
 * nothing else. Every other module receives plain values from here, never process.env.
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 steps 6 and 7 and B4 (Rust passes the
 * bin dir, the outbox root and a log location through environment variables).
 * Must handle: a missing or empty variable (return an error that names it, no silent default), a
 * relative path (refused: every path must be absolute), and unknown variables (ignored).
 * Test first: an environment without CONDUCTED_BIN_DIR returns an error naming that variable.
 * Our design choice: the variable names are ours. The Rust launcher (PLAT-09) must set them.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { z } from "zod";

/** Names of the environment variables the Rust launcher sets for the sidecar. */
export const SIDECAR_ENV = {
	/** Folder holding checkpointer.sh, git-busy-check.sh and spotlighter.sh. */
	binDir: "CONDUCTED_BIN_DIR",
	/** Folder for the write-ahead event log, one file per chat. */
	outboxRoot: "CONDUCTED_OUTBOX_ROOT",
	/**
	 * Folder for the sidecar's log files, which SIDE-18 writes. Today the sidecar writes log
	 * lines to stderr, which the Rust launcher stores in the app log files (D026), so this folder
	 * is not written or probed yet.
	 */
	logDir: "CONDUCTED_LOG_DIR",
} as const;

const absolutePath = z
	.string()
	.min(1)
	.refine((value) => value.startsWith("/"), "must be an absolute path");

const zSidecarConfig = z.object({
	binDir: absolutePath,
	outboxRoot: absolutePath,
	logDir: absolutePath,
});
export type SidecarConfig = z.infer<typeof zSidecarConfig>;

export function parseSidecarConfig(
	env: Readonly<Record<string, string | undefined>>,
): Result<SidecarConfig> {
	const parsed = zSidecarConfig.safeParse({
		binDir: env[SIDECAR_ENV.binDir],
		outboxRoot: env[SIDECAR_ENV.outboxRoot],
		logDir: env[SIDECAR_ENV.logDir],
	});
	if (parsed.success) return ok(parsed.data);
	const problems = parsed.error.issues.map((issue) => {
		const key = issue.path[0] as keyof typeof SIDECAR_ENV;
		return `${SIDECAR_ENV[key]}: ${issue.message}`;
	});
	return err(appError("config_invalid", `Sidecar settings are wrong. ${problems.join("; ")}`));
}

/** Environment variables of the logger mode. The Rust launcher sets both. */
export const LOGGER_ENV = {
	/** The bearer token that clients present to the logger's HTTP routes. */
	token: "CONDUCTED_LOGGER_TOKEN",
	/** Folder for optional log files. Empty or unset: keep logs in memory only. */
	persistDir: "CONDUCTED_LOGGER_DIR",
} as const;

export interface LoggerConfig {
	token: string;
	persistDir: string | null;
}

export function parseLoggerConfig(
	env: Readonly<Record<string, string | undefined>>,
): Result<LoggerConfig> {
	const token = env[LOGGER_ENV.token];
	if (token === undefined || token === "") {
		return err(appError("config_invalid", `${LOGGER_ENV.token} is not set`));
	}
	const dir = env[LOGGER_ENV.persistDir];
	if (dir !== undefined && dir !== "" && !dir.startsWith("/")) {
		return err(appError("config_invalid", `${LOGGER_ENV.persistDir} must be an absolute path`));
	}
	return ok({ token, persistDir: dir === undefined || dir === "" ? null : dir });
}
