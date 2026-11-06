/**
 * @feature SIDE-01 Entry point and modes
<<<<<<< HEAD
<<<<<<< HEAD
 * Owns: reading the sidecar and logger startup settings from the environment the Rust shell sets,
 * including the optional bundled skill plugin folder, and nothing else. Every other module
 * receives plain values from here, never process.env.
=======
 * Owns: reading the sidecar startup settings from the environment the Rust shell sets, and nothing
 * else. Every other module receives plain values from here, never process.env.
>>>>>>> 855fd49e8f408c81a5c1bf4c4fd81b1039a05b13
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 steps 6 and 7 and B4 (Rust passes the
 * bin dir, the outbox root, a log location, the app version and the log level through environment
 * variables). The log level and app version are read for SIDE-18.
=======
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: reading the sidecar and logger startup settings from the environment the Rust shell sets, and
 * nothing else. Every other module receives plain values from here, never process.env.
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 steps 6 and 7 and B4 (Rust passes the
 * bin dir, the outbox root, the slash-command cache folder and a log location through environment
 * variables).
>>>>>>> b4a6951929ba98e7d41acdc123993e987fe8afaf
 * Must handle: a missing or empty variable (return an error that names it, no silent default), a
 * relative path (refused: every path must be absolute), an unknown log level (refused), and
 * unknown variables (ignored).
 * Test first: an environment without CONDUCTED_BIN_DIR returns an error naming that variable.
 * Our design choice: the variable names are ours. The Rust launcher (PLAT-09) must set them.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./logging/logger.ts";

/** Names of the environment variables the Rust launcher sets for the sidecar. */
export const SIDECAR_ENV = {
	/** Folder holding checkpointer.sh, git-busy-check.sh and spotlighter.sh. */
	binDir: "CONDUCTED_BIN_DIR",
	/** Folder for the write-ahead event log, one file per chat. */
	outboxRoot: "CONDUCTED_OUTBOX_ROOT",
<<<<<<< HEAD
	/** Folder where the Rust launcher keeps the sidecar's log files (D026). */
=======
	/** Folder for the saved slash-command lists the new-workspace composer reads (SIDE-22). */
	completionsDir: "CONDUCTED_COMPLETIONS_DIR",
	/**
	 * Folder for the sidecar's log files, which SIDE-18 writes. Today the sidecar writes log
	 * lines to stderr, which the Rust launcher stores in the app log files (D026), so this folder
	 * is not written or probed yet.
	 */
>>>>>>> b4a6951929ba98e7d41acdc123993e987fe8afaf
	logDir: "CONDUCTED_LOG_DIR",
<<<<<<< HEAD
	/** Folder of the app's bundled Claude skill plugin, when the build has one (AGENT-18). */
	skillPluginDir: "CONDUCTED_SKILL_PLUGIN_DIR",
=======
	/** The app version, kept in the log records. */
	appVersion: "CONDUCTED_APP_VERSION",
	/** The most detailed level the sidecar writes. */
	logLevel: "CONDUCTED_LOG_LEVEL",
>>>>>>> 855fd49e8f408c81a5c1bf4c4fd81b1039a05b13
} as const;

const absolutePath = z
	.string()
	.min(1)
	.refine((value) => value.startsWith("/"), "must be an absolute path");

const zSidecarConfig = z.object({
	binDir: absolutePath,
	outboxRoot: absolutePath,
	completionsDir: absolutePath,
	logDir: absolutePath,
<<<<<<< HEAD
	skillPluginDir: absolutePath.optional(),
=======
	appVersion: z.string().min(1),
	logLevel: z.enum(LOG_LEVELS),
>>>>>>> 855fd49e8f408c81a5c1bf4c4fd81b1039a05b13
});
export type SidecarConfig = z.infer<typeof zSidecarConfig> & { logLevel: LogLevel };

export function parseSidecarConfig(
	env: Readonly<Record<string, string | undefined>>,
): Result<SidecarConfig> {
	const parsed = zSidecarConfig.safeParse({
		binDir: env[SIDECAR_ENV.binDir],
		outboxRoot: env[SIDECAR_ENV.outboxRoot],
		completionsDir: env[SIDECAR_ENV.completionsDir],
		logDir: env[SIDECAR_ENV.logDir],
<<<<<<< HEAD
		skillPluginDir: env[SIDECAR_ENV.skillPluginDir],
=======
		appVersion: env[SIDECAR_ENV.appVersion],
		logLevel: env[SIDECAR_ENV.logLevel],
>>>>>>> 855fd49e8f408c81a5c1bf4c4fd81b1039a05b13
	});
	if (parsed.success) return ok(parsed.data);
	const problems = parsed.error.issues.map((issue) => {
		const key = issue.path[0] as keyof typeof SIDECAR_ENV;
		return `${SIDECAR_ENV[key]}: ${issue.message}`;
	});
	return err(appError("config_invalid", `Sidecar settings are wrong. ${problems.join("; ")}`));
}
