/**
 * @feature SIDE-01 Entry point and modes
 * @feature SIDE-18 Sidecar logs go to the Rust shell's log files
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * @feature AGENT-18 Bundled skill that teaches agents the app
 * @feature AGENT-09 Cursor: SDK in process
 * Owns: reading the sidecar startup settings from the environment the Rust shell sets: the bin
 * folder, the managed programs folder (PLAT-28), the outbox root, the slash-command cache folder, the Cursor run store folder, the log
 * folder, the app version, the log level and, when the build has one, the bundled skill plugin
 * folder. Nothing else. Every other module receives plain values from here, never process.env.
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 steps 6 and 7 and B4 (Rust passes
 * these through environment variables), other-runners.md 2.3 (the Cursor SDK's local run store).
 * SIDE-18 reads the app version and log level; SIDE-22 reads the slash-command cache folder;
 * AGENT-18 reads the skill plugin folder; AGENT-09 reads the Cursor run store folder.
 * Must handle: a missing or empty variable (return an error that names it, no silent default), a
 * relative path (refused: every path must be absolute), an unknown log level (refused), and
 * unknown variables (ignored). The skill plugin folder is optional: a build without one leaves it
 * unset.
 * Test first: an environment without CONDUCTED_BIN_DIR returns an error naming that variable.
 * Our design choice: the variable names are ours. The Rust launcher (PLAT-09) must set them.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { z } from "zod";
import { LOG_LEVELS, type LogLevel } from "./logging/logger.ts";

/** Names of the environment variables the Rust launcher sets for the sidecar. */
export const SIDECAR_ENV = {
	/**
	 * The app's bin folder: checkpointer.sh, git-busy-check.sh and spotlighter.sh, and the program
	 * manager's links to the managed programs (PLAT-28, PLAT-35).
	 */
	binDir: "CONDUCTED_BIN_DIR",
	/** Folder the program manager downloads the managed programs into (PLAT-28). */
	agentBinariesDir: "CONDUCTED_AGENT_BINARIES_DIR",
	/** Folder for the write-ahead event log, one file per chat. */
	outboxRoot: "CONDUCTED_OUTBOX_ROOT",
	/** Folder for the saved slash-command lists the new-workspace composer reads (SIDE-22). */
	completionsDir: "CONDUCTED_COMPLETIONS_DIR",
	/** Root of the Cursor SDK's local run stores, one folder per workspace inside (AGENT-09). */
	cursorStoreDir: "CONDUCTED_CURSOR_STORE_DIR",
	/** Folder where the Rust launcher keeps the sidecar's log files (D026). */
	logDir: "CONDUCTED_LOG_DIR",
	/** Folder of the app's bundled Claude skill plugin, when the build has one (AGENT-18). */
	skillPluginDir: "CONDUCTED_SKILL_PLUGIN_DIR",
	/** The app version, kept in the log records (SIDE-18). */
	appVersion: "CONDUCTED_APP_VERSION",
	/** The most detailed level the sidecar writes (SIDE-18). */
	logLevel: "CONDUCTED_LOG_LEVEL",
} as const;

const absolutePath = z
	.string()
	.min(1)
	.refine((value) => value.startsWith("/"), "must be an absolute path");

const zSidecarConfig = z.object({
	binDir: absolutePath,
	agentBinariesDir: absolutePath,
	outboxRoot: absolutePath,
	completionsDir: absolutePath,
	cursorStoreDir: absolutePath,
	logDir: absolutePath,
	skillPluginDir: absolutePath.optional(),
	appVersion: z.string().min(1),
	logLevel: z.enum(LOG_LEVELS),
});
export type SidecarConfig = z.infer<typeof zSidecarConfig> & { logLevel: LogLevel };

export function parseSidecarConfig(
	env: Readonly<Record<string, string | undefined>>,
): Result<SidecarConfig> {
	const parsed = zSidecarConfig.safeParse({
		binDir: env[SIDECAR_ENV.binDir],
		agentBinariesDir: env[SIDECAR_ENV.agentBinariesDir],
		outboxRoot: env[SIDECAR_ENV.outboxRoot],
		completionsDir: env[SIDECAR_ENV.completionsDir],
		cursorStoreDir: env[SIDECAR_ENV.cursorStoreDir],
		logDir: env[SIDECAR_ENV.logDir],
		skillPluginDir: env[SIDECAR_ENV.skillPluginDir],
		appVersion: env[SIDECAR_ENV.appVersion],
		logLevel: env[SIDECAR_ENV.logLevel],
	});
	if (parsed.success) return ok(parsed.data);
	const problems = parsed.error.issues.map((issue) => {
		const key = issue.path[0] as keyof typeof SIDECAR_ENV;
		return `${SIDECAR_ENV[key]}: ${issue.message}`;
	});
	return err(appError("config_invalid", `Sidecar settings are wrong. ${problems.join("; ")}`));
}
