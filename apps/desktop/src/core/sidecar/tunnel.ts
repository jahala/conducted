/**
 * @feature CHAT-18 JSON-RPC tunnel to the sidecar
 * Owns: the typed request and notification channel between the UI and the sidecar, over the raw
 * line transport in `Platform.sidecar`. One JSON-RPC message per line (NDJSON). Both directions
 * are validated with the schemas in packages/protocol/src/rpc.ts.
 * Behaviour: frontend.md 3c (the tunnel: a JSON-RPC peer that is client and server at once),
 * sessions.md 10 (wire contract, errors become -32000), sessions.md 8 (a new connection
 * re-registers every method; the sidecar may still be alive).
 * Must handle: a request that times out (the Err carries code `rpc_timeout` and a late answer is
 * dropped); the sidecar restarting while requests are pending (all of them fail with
 * `sidecar_restarted`, then `onReconnected` listeners run); params or results that fail
 * validation (an Err with code `rpc_invalid`, never a throw into the caller); a sidecar request
 * for a method we have no handler for (answer -32601); a handler that throws (answer -32603,
 * logged); lines that are not JSON (logged and skipped); messages sent before `start` finishes
 * wait for it.
 * Our design choice: the json-rpc-2.0 package does the framing and id matching. This class adds
 * the schemas, timeouts and the restart rule. Request and notification names are the keys of the
 * tables in the protocol package, so a rename there is a type error here.
 * Test first: a request whose result does not match its schema returns Err with code rpc_invalid.
 */
import type {
	AppToSidecarNotification,
	AppToSidecarRequest,
	appToSidecarNotifications,
	appToSidecarRequests,
	ParamsOf,
	ResultOf,
	SidecarToAppNotification,
	SidecarToAppRequest,
	sidecarToAppNotifications,
	sidecarToAppRequests,
} from "@conducted/protocol";
import { notImplemented, type Result } from "@conducted/shared";
import type { z } from "zod";
import type { SidecarTransport, Unsubscribe } from "../../platform/platform.ts";

export type AppToSidecarParams<K extends AppToSidecarRequest> = ParamsOf<
	(typeof appToSidecarRequests)[K]
>;
export type AppToSidecarResult<K extends AppToSidecarRequest> = ResultOf<
	(typeof appToSidecarRequests)[K]
>;
export type AppToSidecarNotificationParams<K extends AppToSidecarNotification> = z.infer<
	(typeof appToSidecarNotifications)[K]
>;
export type SidecarToAppParams<K extends SidecarToAppRequest> = ParamsOf<
	(typeof sidecarToAppRequests)[K]
>;
export type SidecarToAppResult<K extends SidecarToAppRequest> = ResultOf<
	(typeof sidecarToAppRequests)[K]
>;
export type SidecarToAppNotificationParams<K extends SidecarToAppNotification> = z.infer<
	(typeof sidecarToAppNotifications)[K]
>;

/** What the UI answers when the sidecar asks. One handler per method of `sidecarToAppRequests`. */
export type SidecarRequestHandlers = {
	[K in SidecarToAppRequest]: (params: SidecarToAppParams<K>) => Promise<SidecarToAppResult<K>>;
};

/** What the UI does when the sidecar tells it something. One handler per notification. */
export type SidecarNotificationHandlers = {
	[K in SidecarToAppNotification]: (params: SidecarToAppNotificationParams<K>) => Promise<void>;
};

/** The part of the tunnel that services use. A test can pass any object with these two methods. */
export interface SidecarClient {
	request<K extends AppToSidecarRequest>(
		method: K,
		params: AppToSidecarParams<K>,
	): Promise<Result<AppToSidecarResult<K>>>;
	notify<K extends AppToSidecarNotification>(
		method: K,
		params: AppToSidecarNotificationParams<K>,
	): Promise<Result<void>>;
}

/** Time to wait for an answer, per request. Everything else uses `DEFAULT_RPC_TIMEOUT_MS`. */
export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/** Our design choice: slow catalog calls get more time; interactive calls get less. */
export const RPC_TIMEOUTS_MS: Partial<Record<AppToSidecarRequest, number>> = {
	sendMessage: 60_000,
	warmAgent: 60_000,
	listModels: 120_000,
	listSlashCommands: 20_000,
	listMcpServers: 20_000,
	getSessionStatus: 5_000,
	getContextUsage: 10_000,
	getShellEnv: 6_000,
	cancel: 15_000,
};

export const rpcTimeoutFor = (method: AppToSidecarRequest): number =>
	RPC_TIMEOUTS_MS[method] ?? DEFAULT_RPC_TIMEOUT_MS;

export interface SidecarTunnelDeps {
	transport: SidecarTransport;
	requestHandlers: SidecarRequestHandlers;
	notificationHandlers: SidecarNotificationHandlers;
	log: (level: "error" | "warn" | "info" | "debug", message: string, data?: unknown) => void;
	/** Fires a timer. A parameter so tests need no real clock. */
	setTimer: (callback: () => void, ms: number) => () => void;
}

export class SidecarTunnel implements SidecarClient {
	readonly #deps: SidecarTunnelDeps;

	constructor(deps: SidecarTunnelDeps) {
		this.#deps = deps;
	}

	/** Asks the Rust shell to start the sidecar, then attaches to its lines and restart signal. */
	start(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("CHAT-18");
	}

	stop(): void {
		notImplemented("CHAT-18");
	}

	/** Runs after a restart, once the new connection is up and handlers are registered again. */
	onReconnected(_listener: () => void): Unsubscribe {
		return notImplemented("CHAT-18");
	}

	request<K extends AppToSidecarRequest>(
		_method: K,
		_params: AppToSidecarParams<K>,
	): Promise<Result<AppToSidecarResult<K>>> {
		return notImplemented("CHAT-18");
	}

	notify<K extends AppToSidecarNotification>(
		_method: K,
		_params: AppToSidecarNotificationParams<K>,
	): Promise<Result<void>> {
		return notImplemented("CHAT-18");
	}
}
