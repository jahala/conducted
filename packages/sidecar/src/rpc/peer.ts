/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: one typed JSON-RPC 2.0 peer. It answers the app's requests with the handler tables,
 * validates every incoming and outgoing message with the protocol schemas, and offers request and
 * notify calls toward the app.
 * Behaviour: research/conductor/sessions.md section 10 and section 8 ("Each connection
 * re-registers all RPC methods ... pending requests are rejected with 'Frontend RPC tunnel
 * stopped'"). Conductor uses the json-rpc-2.0 library's server-and-client pair; so do we.
 * Must handle:
 *  - params that fail the schema: answer with RPC_ERRORS.invalidParams, never call the handler
 *  - a result that fails its schema: log it and answer RPC_ERRORS.internalError
 *  - a handler that throws NotImplemented: answer RPC_ERRORS.notImplemented with the feature id
 *  - a request toward the app while detached: return an error value at once
 *  - detach while requests are in flight: every pending request resolves with an error value
 *  - a late response for a request that already timed out is ignored
 *  - requestInteraction has no timeout (a person answers when ready); the others default to 20 s
 * Test first: two peers joined by an in-memory transport; a request with bad params gets
 * invalidParams and the handler is not called.
 * Our design choice: the transport is a small port (RpcTransport), so tests use an in-memory pair
 * and production uses the Unix socket from server.ts.
 */
import type { SidecarToAppNotification, SidecarToAppRequest } from "@conducted/protocol";
import { type AppError, notImplemented, type Result } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type {
	AppToSidecarHandlers,
	AppToSidecarNotificationHandlers,
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "./types.ts";

/** Default time to wait for the app's reply. requestInteraction is exempt. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/** One attached connection, reduced to what the peer needs. */
export interface RpcTransport {
	/** Writes one already-encoded line. */
	writeLine(line: string): void;
	/** Registers the receiver of incoming text chunks. Called once. */
	onData(listener: (chunk: string) => void): void;
	/** Registers the receiver of the close event. Called once. */
	onClose(listener: () => void): void;
	close(): void;
}

export interface RpcPeerDeps {
	handlers: AppToSidecarHandlers;
	notificationHandlers: AppToSidecarNotificationHandlers;
	logger: Logger;
}

/**
 * The attach point for connections. There is one app at a time: attach() replaces the previous
 * transport, which lets the app reconnect to a living sidecar without losing sessions.
 */
export class RpcPeer implements SidecarToApp {
	constructor(protected readonly deps: RpcPeerDeps) {}

	get connected(): boolean {
		return notImplemented("SIDE-02");
	}

	/** Attaches a new connection and drops the old one. Fires the onAttach listeners. */
	attach(_transport: RpcTransport): void {
		notImplemented("SIDE-02");
	}

	/** Closes the current connection, if any. Fires the onDetach listeners. */
	detach(): void {
		notImplemented("SIDE-02");
	}

	request<K extends SidecarToAppRequest>(
		_method: K,
		_params: SidecarToAppRequestParams<K>,
		_options?: { timeoutMs?: number },
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		return notImplemented("SIDE-02");
	}

	notify<K extends SidecarToAppNotification>(
		_method: K,
		_params: SidecarToAppNotificationParams<K>,
	): boolean {
		return notImplemented("SIDE-02");
	}

	onAttach(_listener: () => void): () => void {
		return notImplemented("SIDE-02");
	}

	onDetach(_listener: () => void): () => void {
		return notImplemented("SIDE-02");
	}
}
