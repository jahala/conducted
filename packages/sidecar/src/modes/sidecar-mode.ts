/**
 * @feature SIDE-01 Entry point and modes: the "sidecar" mode
 * Owns: starting the agent host. It is the composition root: the one place that creates every
 * real port (processes, files, sockets, clocks) and passes them to the modules.
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 and B1 and sessions.md sections 0, 5
 * and 8. Startup order:
 *  1. read the settings from the environment (config.ts); a bad value prints a message and exits 64
 *  2. create the logger (logging/logger.ts) writing to a file in the log dir, mode 0600
 *  3. capture the login-shell environment (shell-env) in the background; it is needed by the first
 *     agent start, not before
 *  4. open the write-ahead log (outbox/); a failure is fatal: exit 1 with the reason. Conductor
 *     continues without a backup after 1 s; we do not, because the log is what makes delivery safe
 *  5. build the runners, process manager, session manager, interaction broker, publisher and the
 *     app tools backend and bridge
 *  6. listen on the Unix socket (rpc/server.ts) and print SOCKET_PATH=<path> as one line on stdout
 *  7. start the parent watchdog (watchdog.ts), install signal handlers, and install the
 *     uncaughtException and unhandledRejection handlers (log, do not exit)
 *  8. when the app attaches: replay the write-ahead log, resend the open interaction, and send
 *     agentInstallsChanged if detection changed
 * Must handle: a second sidecar already running for the same app (the launcher kills orphans; the
 * socket path includes the pid, so two never clash), startup steps that fail halfway (everything
 * started so far is stopped through the shutdown steps), and stdout carrying only handshake lines
 * (logs go to the file).
 * Test first: parseSidecarConfig is tested in config.test.ts; here, a start with an unwritable
 * outbox directory exits with code 1 and a message that names the directory.
 */
import { notImplemented } from "@conducted/shared";

/** Runs until shutdown. Returns the process exit code. */
export function runSidecarMode(
	_env: Readonly<Record<string, string | undefined>>,
	_args: readonly string[],
): Promise<number> {
	return notImplemented("SIDE-01");
}
