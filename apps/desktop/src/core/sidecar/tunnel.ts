/**
 * @feature CHAT-18 JSON-RPC tunnel to the sidecar
 * Owns: the typed request and notification channel between the UI and the sidecar, over the raw
 * line transport in `Platform.sidecar`. One JSON-RPC message per line (NDJSON). Both directions
 * are validated with the schemas in packages/protocol/src/rpc.ts.
 * Behaviour: frontend.md 3c (the tunnel: a JSON-RPC peer that is client and server at once),
 * sessions.md 10 (wire contract, errors become -32000), sessions.md 8 (a new connection
 * re-registers every method; the sidecar may still be alive).
 * Must handle: a request that times out (the Err carries code `rpc_timeout`); the sidecar
 * restarting while requests are pending (all of them fail with `sidecar_restarted`, then
 * `onReconnected` listeners run once the new connection is up); params or results that fail
 * validation (an Err with code `rpc_invalid`, never a throw into the caller); a sidecar request
 * for a method we have no handler for (answer -32601); a handler that throws (answer -32603,
 * logged); lines that are not JSON (logged and skipped); messages sent before `start` finishes
 * wait for it.
 * Our design choice: the json-rpc-2.0 package does the framing and id matching. This class adds
 * the schemas, timeouts and the restart rule. Request and notification names are the keys of the
 * tables in the protocol package, so a rename there is a type error here.
 * Test first: a request whose result does not match its schema returns Err with code rpc_invalid.
 */
import {
	type AppToSidecarNotification,
	type AppToSidecarRequest,
	appToSidecarNotifications,
	appToSidecarRequests,
	type ParamsOf,
	type ResultOf,
	RPC_ERRORS,
	type SidecarToAppNotification,
	type SidecarToAppRequest,
	sidecarToAppNotifications,
	sidecarToAppRequests,
} from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import {
	createJSONRPCErrorResponse,
	createJSONRPCNotification,
	JSONRPCClient,
	JSONRPCErrorException,
	type JSONRPCResponse,
	JSONRPCServer,
	JSONRPCServerAndClient,
} from "json-rpc-2.0";
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

/** json-rpc-2.0 resolves the pending request with this code when the connection closes. */
const LIBRARY_CONNECTION_CLOSED_CODE = 0;

/** Raised inside a request when its method's timeout passes before the answer arrives. */
class RpcTimeoutError extends Error {
	override readonly name = "RpcTimeoutError";

	constructor(timeoutMs: number) {
		super(`The sidecar did not answer within ${timeoutMs} ms`);
	}
}

export class SidecarTunnel implements SidecarClient {
	readonly #deps: SidecarTunnelDeps;
	#endpoint: JSONRPCServerAndClient | null = null;
	#startPromise: Promise<Result<void>> | null = null;
	/** The reconnect in progress, if any. Requests wait for it instead of using a dead endpoint. */
	#ready: Promise<Result<void>> | null = null;
	#lineUnsubscribe: Unsubscribe | null = null;
	#restartUnsubscribe: Unsubscribe | null = null;
	/** Bumped on every restart, so a closed pending request can be told apart from a send failure. */
	#generation = 0;
	/** Lines that arrived before the first endpoint was built, replayed once it exists. */
	#inbound: unknown[] = [];
	readonly #reconnectedListeners = new Set<() => void>();

	constructor(deps: SidecarTunnelDeps) {
		this.#deps = deps;
	}

	/** Asks the Rust shell to start the sidecar, then attaches to its lines and restart signal. */
	start(): Promise<Result<void>> {
		this.#startPromise ??= this.#runStart();
		return this.#startPromise;
	}

	async #runStart(): Promise<Result<void>> {
		if (this.#lineUnsubscribe === null) {
			this.#lineUnsubscribe = this.#deps.transport.onLine((line) => this.#receiveLine(line));
			this.#restartUnsubscribe = this.#deps.transport.onRestart(() => this.#handleRestart());
		}
		const started = await this.#deps.transport.ensureStarted();
		if (!started.ok) return started;
		this.#endpoint = this.#buildEndpoint();
		this.#drainInbound();
		return ok(undefined);
	}

	stop(): void {
		this.#lineUnsubscribe?.();
		this.#lineUnsubscribe = null;
		this.#restartUnsubscribe?.();
		this.#restartUnsubscribe = null;
		this.#endpoint?.rejectAllPendingRequests("The sidecar connection was stopped.");
		this.#endpoint = null;
		this.#inbound = [];
		this.#reconnectedListeners.clear();
		this.#startPromise = null;
		this.#ready = null;
	}

	/** Runs after a restart, once the new connection is up and handlers are registered again. */
	onReconnected(listener: () => void): Unsubscribe {
		this.#reconnectedListeners.add(listener);
		return () => {
			this.#reconnectedListeners.delete(listener);
		};
	}

	async request<K extends AppToSidecarRequest>(
		method: K,
		params: AppToSidecarParams<K>,
	): Promise<Result<AppToSidecarResult<K>>> {
		const ready = await this.#waitForReady();
		if (!ready.ok) return err(ready.error);
		const endpoint = this.#endpoint;
		if (endpoint === null) return err(this.#notStarted());

		const spec = appToSidecarRequests[method];
		const parsed = spec.params.safeParse(params);
		if (!parsed.success) {
			return err(appError("rpc_invalid", `The ${method} params are not valid`, parsed.error));
		}

		const generation = this.#generation;
		let rejectTimeout: ((cause: unknown) => void) | null = null;
		const timeout = new Promise<never>((_resolve, reject) => {
			rejectTimeout = reject;
		});
		const timeoutMs = rpcTimeoutFor(method);
		const cancelTimer = this.#deps.setTimer(() => {
			rejectTimeout?.(new RpcTimeoutError(timeoutMs));
		}, timeoutMs);

		try {
			const response = (await Promise.race([
				Promise.resolve(
					endpoint.requestAdvanced({ jsonrpc: "2.0", method, params: parsed.data }, undefined),
				),
				timeout,
			])) as JSONRPCResponse;

			if (response.error) {
				if (response.error.code === LIBRARY_CONNECTION_CLOSED_CODE) {
					return err(
						generation !== this.#generation
							? appError("sidecar_restarted", "The sidecar restarted before it answered.")
							: appError("rpc_failed", response.error.message),
					);
				}
				return err(
					appError(`rpc_error_${response.error.code}`, response.error.message, response.error.data),
				);
			}

			const validated = spec.result.safeParse(response.result);
			if (!validated.success) {
				this.#deps.log("error", `The ${method} answer does not match its schema`, {
					method,
					issues: validated.error.issues,
				});
				return err(appError("rpc_invalid", `The ${method} answer is not valid`, validated.error));
			}
			return ok(validated.data as AppToSidecarResult<K>);
		} catch (cause) {
			if (cause instanceof RpcTimeoutError) {
				return err(appError("rpc_timeout", cause.message));
			}
			return err(appError("rpc_failed", `The ${method} call to the sidecar failed`, cause));
		} finally {
			cancelTimer();
		}
	}

	async notify<K extends AppToSidecarNotification>(
		method: K,
		params: AppToSidecarNotificationParams<K>,
	): Promise<Result<void>> {
		const ready = await this.#waitForReady();
		if (!ready.ok) return err(ready.error);
		const endpoint = this.#endpoint;
		if (endpoint === null) return err(this.#notStarted());

		const parsed = appToSidecarNotifications[method].safeParse(params);
		if (!parsed.success) {
			return err(appError("rpc_invalid", `The ${method} params are not valid`, parsed.error));
		}
		try {
			await endpoint.client.send(createJSONRPCNotification(method, parsed.data), undefined);
			return ok(undefined);
		} catch (cause) {
			return err(appError("rpc_failed", `The ${method} notification to the sidecar failed`, cause));
		}
	}

	#waitForReady(): Promise<Result<void>> {
		if (this.#ready !== null) return this.#ready;
		if (this.#startPromise !== null) return this.#startPromise;
		return Promise.resolve(err(this.#notStarted()));
	}

	#notStarted() {
		return appError("sidecar_not_started", "The sidecar has not been started.");
	}

	#buildEndpoint(): JSONRPCServerAndClient {
		const errorListener = (message: string, data: unknown): void => {
			this.#deps.log("warn", message, data);
		};
		const server = new JSONRPCServer({ errorListener });
		server.mapErrorToJSONRPCErrorResponse = (id, error) => {
			const failure =
				error instanceof JSONRPCErrorException
					? { code: error.code, message: error.message, data: error.data }
					: {
							code: RPC_ERRORS.internalError,
							message: error instanceof Error ? error.message : String(error),
							data: undefined,
						};
			return createJSONRPCErrorResponse(id, failure.code, failure.message, failure.data);
		};
		const client = new JSONRPCClient(async (payload) => {
			const sent = await this.#deps.transport.send(`${JSON.stringify(payload)}\n`);
			if (!sent.ok) throw new Error(sent.error.message);
		});
		const endpoint = new JSONRPCServerAndClient(server, client, { errorListener });
		this.#registerHandlers(endpoint);
		return endpoint;
	}

	#registerHandlers(endpoint: JSONRPCServerAndClient): void {
		for (const method of Object.keys(sidecarToAppRequests) as SidecarToAppRequest[]) {
			const spec = sidecarToAppRequests[method];
			endpoint.addMethod(method, async (params?: unknown) => {
				const parsed = spec.params.safeParse(params === undefined ? {} : params);
				if (!parsed.success) {
					throw new JSONRPCErrorException(
						`The ${method} params are not valid`,
						RPC_ERRORS.invalidParams,
						parsed.error.issues,
					);
				}
				const handler = this.#deps.requestHandlers[method] as (value: unknown) => Promise<unknown>;
				const output = await handler(parsed.data);
				const validated = spec.result.safeParse(output);
				if (!validated.success) {
					throw new JSONRPCErrorException(
						`The ${method} result is not valid`,
						RPC_ERRORS.internalError,
						validated.error.issues,
					);
				}
				return validated.data;
			});
		}

		for (const method of Object.keys(sidecarToAppNotifications) as SidecarToAppNotification[]) {
			const schema = sidecarToAppNotifications[method];
			endpoint.addMethod(method, async (params?: unknown) => {
				const parsed = schema.safeParse(params === undefined ? {} : params);
				if (!parsed.success) {
					throw new JSONRPCErrorException(
						`The ${method} params are not valid`,
						RPC_ERRORS.invalidParams,
						parsed.error.issues,
					);
				}
				const handler = this.#deps.notificationHandlers[method] as (
					value: unknown,
				) => Promise<void>;
				await handler(parsed.data);
				return null;
			});
		}
	}

	#receiveLine(line: string): void {
		let payload: unknown;
		try {
			payload = JSON.parse(line);
		} catch (cause) {
			this.#deps.log("warn", "A sidecar line is not valid JSON", cause);
			return;
		}
		const endpoint = this.#endpoint;
		if (endpoint === null) {
			this.#inbound.push(payload);
			return;
		}
		void this.#dispatch(endpoint, payload);
	}

	async #dispatch(endpoint: JSONRPCServerAndClient, payload: unknown): Promise<void> {
		try {
			await endpoint.receiveAndSend(payload, undefined, undefined);
		} catch (cause) {
			this.#deps.log("warn", "A sidecar message could not be handled", cause);
		}
	}

	#drainInbound(): void {
		const endpoint = this.#endpoint;
		if (endpoint === null) return;
		const buffered = this.#inbound;
		this.#inbound = [];
		for (const payload of buffered) {
			void this.#dispatch(endpoint, payload);
		}
	}

	/** Fails every pending request, then reconnects and tells the listeners once it is up. */
	#handleRestart(): void {
		this.#endpoint?.rejectAllPendingRequests("The sidecar restarted.");
		this.#generation += 1;
		this.#endpoint = null;
		this.#inbound = [];
		const previous = this.#ready ?? this.#startPromise ?? Promise.resolve(ok(undefined));
		this.#ready = this.#reconnect(previous);
	}

	async #reconnect(previous: Promise<Result<void>>): Promise<Result<void>> {
		await previous;
		const started = await this.#deps.transport.ensureStarted();
		if (!started.ok) {
			this.#deps.log("warn", "Reconnecting to the sidecar failed", started.error);
			return started;
		}
		this.#endpoint = this.#buildEndpoint();
		this.#drainInbound();
		for (const listener of this.#reconnectedListeners) listener();
		return ok(undefined);
	}
}
