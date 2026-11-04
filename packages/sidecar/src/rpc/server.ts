/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: the Unix socket listener. It accepts the Rust shell's connection, wraps it as an
 * RpcTransport and attaches it to the RpcPeer, and prints the handshake line for the launcher.
 * Behaviour: research/conductor/native-and-sidecar-map.md A6 step 3 and 5 (the sidecar prints
 * SOCKET_PATH=<path>, listens on $TMPDIR/<name>-<pid>.sock, and Rust connects) and sessions.md
 * section 8 (the app can reconnect to a living sidecar).
 * Must handle:
 *  - a second connection while one is attached: the new one wins, the old one is closed
 *  - a stale socket file from a crashed run: removed before listen
 *  - the socket file mode: 0600, owner only
 *  - close(): stop accepting, close the attached connection, remove the socket file
 *  - a bind failure: return an error value, do not throw
 * Test first: listen on a temp path, connect twice; the first connection is closed and the second
 * receives replies.
 * Our design choice: the file name is conducted-sidecar-<pid>.sock, in the OS temp dir.
 */
import { type AppError, notImplemented, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { RpcPeer } from "./peer.ts";

export interface SocketServerDeps {
	peer: RpcPeer;
	logger: Logger;
	/** Absolute path of the socket file to create. */
	socketPath: string;
}

/** Builds the socket path for a process id. The directory comes from the caller (os.tmpdir()). */
export function socketPathFor(tmpDir: string, pid: number): string {
	return `${tmpDir.replace(/\/$/, "")}/conducted-sidecar-${pid}.sock`;
}

/** The line the launcher reads from stdout to learn where to connect. */
export function handshakeLine(socketPath: string): string {
	return `SOCKET_PATH=${socketPath}`;
}

export class SocketServer {
	constructor(protected readonly deps: SocketServerDeps) {}

	listen(): Promise<Result<void, AppError>> {
		return notImplemented("SIDE-02");
	}

	close(): Promise<void> {
		return notImplemented("SIDE-02");
	}
}
