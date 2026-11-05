/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: the Unix socket listener. It accepts the Rust shell's connection, wraps it as an
 * RpcTransport and attaches it to the RpcPeer. It also formats the handshake line the launcher
 * reads; modes/sidecar-mode.ts prints it once the socket is listening.
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
import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { type AppError, appError, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import { messageOf } from "../util/errors.ts";
import type { RpcPeer, RpcTransport } from "./peer.ts";

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
	private server: Server | null = null;
	private readonly sockets = new Set<Socket>();
	private closing = false;
	private started = false;

	constructor(protected readonly deps: SocketServerDeps) {}

	async listen(): Promise<Result<void, AppError>> {
		if (this.server !== null) return { ok: true, value: undefined };
		try {
			await mkdir(dirname(this.deps.socketPath), { recursive: true, mode: 0o700 });
			await removeIfPresent(this.deps.socketPath);
		} catch (cause) {
			return {
				ok: false,
				error: appError(
					"socket_path_failed",
					`The sidecar could not prepare ${this.deps.socketPath}: ${messageOf(cause)}`,
					cause,
				),
			};
		}

		const server = createServer((socket) => this.accept(socket));
		const listening = await new Promise<Result<void, AppError>>((resolve) => {
			const onError = (cause: unknown): void => {
				server.off("listening", onListening);
				resolve({
					ok: false,
					error: appError(
						"listen_failed",
						`The sidecar could not listen on ${this.deps.socketPath}: ${messageOf(cause)}`,
						cause,
					),
				});
			};
			const onListening = (): void => {
				server.off("error", onError);
				resolve({ ok: true, value: undefined });
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(this.deps.socketPath);
		});
		if (!listening.ok) {
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
			await removeIfPresent(this.deps.socketPath).catch(() => {});
			return listening;
		}

		this.server = server;
		this.started = true;
		server.on("error", (cause) => {
			this.deps.logger.error("The sidecar socket server failed", { reason: messageOf(cause) });
		});
		try {
			await chmod(this.deps.socketPath, 0o600);
		} catch (cause) {
			await this.close();
			return {
				ok: false,
				error: appError(
					"socket_mode_failed",
					`The sidecar could not make ${this.deps.socketPath} owner-only: ${messageOf(cause)}`,
					cause,
				),
			};
		}
		this.deps.logger.info("The sidecar is listening", { socketPath: this.deps.socketPath });
		return { ok: true, value: undefined };
	}

	async close(): Promise<void> {
		if (this.closing) return;
		this.closing = true;
		const server = this.server;
		this.server = null;
		this.deps.peer.detach();
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
		if (server?.listening) {
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
			});
		}
		if (this.started) await removeIfPresent(this.deps.socketPath).catch(() => {});
		this.started = false;
		this.closing = false;
	}

	private accept(socket: Socket): void {
		this.sockets.add(socket);
		socket.once("close", () => {
			this.sockets.delete(socket);
		});
		socket.on("error", (cause) => {
			this.deps.logger.warn("A sidecar socket connection failed", { reason: messageOf(cause) });
		});
		const decoder = new TextDecoder();
		const transport: RpcTransport = {
			writeLine: (line) => {
				if (!socket.destroyed) socket.write(line);
			},
			onData: (listener) => {
				socket.on("data", (chunk: Buffer) => {
					listener(decoder.decode(chunk, { stream: true }));
				});
			},
			onClose: (listener) => {
				socket.once("close", listener);
			},
			close: () => {
				socket.destroy();
			},
		};
		this.deps.peer.attach(transport);
	}
}

async function removeIfPresent(target: string): Promise<void> {
	try {
		await unlink(target);
	} catch (cause) {
		if (isMissing(cause)) return;
		throw cause;
	}
}

function isMissing(cause: unknown): boolean {
	return (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		(cause as { code?: string }).code === "ENOENT"
	);
}
