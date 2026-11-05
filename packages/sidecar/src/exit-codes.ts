/**
 * @feature SIDE-01 Entry point and modes: exit codes
 * Owns: the exit codes of the sidecar program, in one module both the entry point and the host
 * import, so the host does not import the entry module that imports it.
 * Behaviour: research/conductor/native-and-sidecar-map.md B1.
 * Must handle: a wrong command line (EX_USAGE) and a start that fails after the command line was
 * read.
 * Test first: main.test.ts checks dispatchMode returns EXIT_USAGE for an unknown mode.
 */

/** Exit code for a wrong command line (EX_USAGE in sysexits.h). */
export const EXIT_USAGE = 64;

/** A start that fails after the command line was read. Matches the entry point's failure code. */
export const EXIT_START_FAILED = 1;
