/**
 * @feature SIDE-18 Logger mode: entry
 * Owns: starting the logger HTTP server from the "logger" mode and printing its port.
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 step 1 and 3 and B5: the logger starts
 * before the sidecar, prints LOGGER_PORT=<n> on stdout, and reads its bearer token and folder from
 * the environment.
 * Must handle: a missing token (print the reason to stderr, exit 64), the same shutdown signals as
 * the sidecar mode, and the parent watchdog (the logger also exits when the app is gone).
 * Test first: with no token in the environment the mode exits with 64.
 */
import { notImplemented } from "@conducted/shared";

export function runLoggerMode(
	_env: Readonly<Record<string, string | undefined>>,
	_args: readonly string[],
): Promise<number> {
	return notImplemented("SIDE-18");
}
