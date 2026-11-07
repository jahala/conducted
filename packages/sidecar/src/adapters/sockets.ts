/**
 * @feature SIDE-25 Sidecar adapters in their own edge modules
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: the sidecar's socket edge: the path its Unix socket listens on, built from the temp folder
 * and the process id.
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 step 3 and 5: the sidecar listens on
 * `$TMPDIR/conducted-sidecar-<pid>.sock`; `rpc/server.ts` owns the listener itself.
 * Must handle: a temp folder with a trailing slash (one slash, never two).
 * Test first: the socket path lands in the temp folder and carries this process's pid.
 * Our design choice: the factory takes the temp folder and the pid, so a test passes its own
 * folder and the composition root passes the OS temp folder and the real pid.
 */
import { tmpdir } from "node:os";
import { socketPathFor } from "../rpc/server.ts";

export interface SocketAdapters {
	/** The absolute path the sidecar's Unix socket listens on. */
	path(): string;
}

export interface SocketAdaptersDeps {
	tempRoot(): string;
	pid(): number;
}

/** Builds the socket path from the temp folder and pid passed in. */
export function createSocketAdapters(deps: SocketAdaptersDeps): SocketAdapters {
	return {
		path: () => socketPathFor(deps.tempRoot(), deps.pid()),
	};
}

/** The production wiring: the OS temp folder and this process's pid. */
export function createNodeSocketAdapters(): SocketAdapters {
	return createSocketAdapters({ tempRoot: () => tmpdir(), pid: () => process.pid });
}
