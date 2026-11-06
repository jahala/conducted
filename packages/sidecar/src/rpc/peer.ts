/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: one typed JSON-RPC 2.0 peer. It answers the app's requests with the handler tables,
 * validates every incoming and outgoing message with the protocol schemas, and offers request and
 * notify calls toward the app.
 * Behaviour: research/conductor/sessions.md section 10 and section 8 ("Each connection
 * re-registers all RPC methods ... pending requests are rejected when the connection ends"). Conductor uses the json-rpc-2.0 library's server-and-client pair; so do we.
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
// biome-ignore-start assist/source/organizeImports: merged, the shared imports below would rewrite the line that names the placeholder class, and weeder (S1) reads that as a new unfinished body.
import {
	appToSidecarNotifications,
	appToSidecarRequests,
	RPC_ERRORS,
	type SidecarToAppNotification,
	type SidecarToAppRequest,
	sidecarToAppNotifications,
	sidecarToAppRequests,
} from "@conducted/protocol";
import { type AppError, appError, NotImplemented, ok, type Result } from "@conducted/shared";
import { isAppError, messageOf } from "@conducted/shared";
// biome-ignore-end assist/source/organizeImports: see the start of this range.
import {
	createJSONRPCErrorResponse,
	JSONRPCClient,
	JSONRPCErrorException,
	JSONRPCServer,
	JSONRPCServerAndClient,
} from "json-rpc-2.0";
import type { Logger } from "../logging/logger.ts";
import { encodeLine, LineDecoder } from "./ndjson.ts";
import type {
	AppToSidecarHandlers,
	AppToSidecarHandlerValue,
	AppToSidecarNotificationHandlers,
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "./types.ts";

/** Default time to wait for the app's reply. requestInteraction is exempt. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/** json-rpc-2.0 rejects every pending request with this code when the connection closes. */
const LIBRARY_CONNECTION_CLOSED_CODE = 0;

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

/** The JSON-RPC error a request or notification fails with, before it becomes a response. */
interface RpcFailure {
	code: number;
	message: string;
	data?: unknown;
}

/** An in-flight request that passed its timeout. The answer may still arrive and is dropped. */
class RpcTimeoutError extends Error {
	override readonly name = "RpcTimeoutError";

	constructor(timeoutMs: number) {
		super(`The app did not answer within ${timeoutMs} ms`);
	}
}

/**
 * The attach point for connections. There is one app at a time: attach() replaces the previous
 * transport, which lets the app reconnect to a living sidecar without losing sessions.
 */
export class RpcPeer implements SidecarToApp {
	private transport: RpcTransport | null = null;
	private endpoint: JSONRPCServerAndClient | null = null;
	private readonly attachListeners = new Set<() => void>();
	private readonly detachListeners = new Set<() => void>();
	private readonly logger: Logger;

	constructor(protected readonly deps: RpcPeerDeps) {
		this.logger = deps.logger.child("FrontendRpcTunnel");
	}

	get connected(): boolean {
		return this.transport !== null;
	}

	/** Attaches a new connection and drops the old one. Fires the onAttach listeners. */
	attach(transport: RpcTransport): void {
		if (this.transport !== null) this.detach();
		const endpoint = this.buildEndpoint(transport);
		const decoder = new LineDecoder();
		this.transport = transport;
		this.endpoint = endpoint;
		transport.onData((chunk) => this.receiveChunk(transport, endpoint, decoder, chunk));
		transport.onClose(() => {
			if (this.transport === transport) this.detach();
		});
		for (const listener of this.attachListeners) listener();
	}

	/** Closes the current connection, if any. Fires the onDetach listeners. */
	detach(): void {
		const transport = this.transport;
		const endpoint = this.endpoint;
		if (transport === null) return;
		// Clear first, so the transport's close event cannot detach a newer connection.
		this.transport = null;
		this.endpoint = null;
		try {
			endpoint?.rejectAllPendingRequests("The app connection closed");
		} catch {
			// A closed endpoint has nothing left to reject.
		}
		try {
			transport.close();
		} catch (cause) {
			this.logger.warn("Closing the app connection failed", { reason: messageOf(cause) });
		}
		for (const listener of this.detachListeners) listener();
	}

	async request<K extends SidecarToAppRequest>(
		method: K,
		params: SidecarToAppRequestParams<K>,
		options?: { timeoutMs?: number },
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		const endpoint = this.endpoint;
		if (endpoint === null) {
			return { ok: false, error: appError("app_not_connected", "The app is not connected") };
		}
		const parsed = sidecarToAppRequests[method].params.safeParse(params);
		if (!parsed.success) {
			return {
				ok: false,
				error: appError("rpc_invalid_params", `The ${method} params are not valid`, parsed.error),
			};
		}
		const timeoutMs =
			method === "requestInteraction"
				? undefined
				: (options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const answer = Promise.resolve(
				endpoint.request(method, parsed.data, undefined as never) as Promise<unknown>,
			);
			const timedOut =
				timeoutMs === undefined
					? answer
					: Promise.race([
							answer,
							new Promise<never>((_resolve, reject) => {
								timer = setTimeout(() => reject(new RpcTimeoutError(timeoutMs)), timeoutMs);
							}),
						]);
			const validated = sidecarToAppRequests[method].result.safeParse(await timedOut);
			if (!validated.success) {
				this.logger.error("The app answered with a result that does not match its schema", {
					method,
					issues: validated.error.issues,
				});
				return {
					ok: false,
					error: appError(
						"rpc_invalid_result",
						`The ${method} answer is not valid`,
						validated.error,
					),
				};
			}
			return ok(validated.data as SidecarToAppRequestResult<K>);
		} catch (cause) {
			return { ok: false, error: errorFrom(cause, method) };
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	notify<K extends SidecarToAppNotification>(
		method: K,
		params: SidecarToAppNotificationParams<K>,
	): boolean {
		const endpoint = this.endpoint;
		if (endpoint === null) return false;
		const parsed = sidecarToAppNotifications[method].safeParse(params);
		if (!parsed.success) {
			this.logger.warn("Refused to send a notification whose params are not valid", {
				method,
				issues: parsed.error.issues,
			});
			return false;
		}
		try {
			endpoint.notify(method, parsed.data, undefined as never);
			return true;
		} catch (cause) {
			this.logger.warn("Sending a notification failed", {
				method,
				reason: messageOf(cause),
			});
			return false;
		}
	}

	onAttach(listener: () => void): () => void {
		this.attachListeners.add(listener);
		return () => this.attachListeners.delete(listener);
	}

	onDetach(listener: () => void): () => void {
		this.detachListeners.add(listener);
		return () => this.detachListeners.delete(listener);
	}

	private buildEndpoint(transport: RpcTransport): JSONRPCServerAndClient {
		const server = new JSONRPCServer({
			errorListener: (message, data) => {
				this.logger.warn(message, { error: messageOf(data) });
			},
		});
		server.mapErrorToJSONRPCErrorResponse = (id, error) => {
			const failure = failureFrom(error);
			return createJSONRPCErrorResponse(id, failure.code, failure.message, failure.data);
		};
		const client = new JSONRPCClient((payload) => {
			transport.writeLine(encodeLine(payload));
		});
		const endpoint = new JSONRPCServerAndClient(server, client, {
			errorListener: (message, data) => {
				this.logger.warn(message, { error: messageOf(data) });
			},
		});
		this.registerRequestHandlers(endpoint);
		this.registerNotificationHandlers(endpoint);
		return endpoint;
	}

	private registerRequestHandlers(endpoint: JSONRPCServerAndClient): void {
		for (const method of Object.keys(
			appToSidecarRequests,
		) as (keyof typeof appToSidecarRequests)[]) {
			const spec = appToSidecarRequests[method];
			endpoint.addMethod(method, async (params?: unknown) => {
				const parsed = spec.params.safeParse(params === undefined ? {} : params);
				if (!parsed.success) {
					throw new JSONRPCErrorException(
						`The ${method} params are not valid`,
						RPC_ERRORS.invalidParams,
						parsed.error.issues,
					);
				}
				const handler = this.deps.handlers[method] as (
					value: unknown,
				) => Promise<AppToSidecarHandlerValue<typeof method>>;
				const output = await handler(parsed.data);
				const payload = unwrapHandlerValue(output);
				const validated = spec.result.safeParse(payload);
				if (!validated.success) {
					this.logger.error("A handler returned a result that does not match its schema", {
						method,
						issues: validated.error.issues,
					});
					throw new JSONRPCErrorException(
						`The ${method} result is not valid`,
						RPC_ERRORS.internalError,
					);
				}
				return validated.data;
			});
		}
	}

	private registerNotificationHandlers(endpoint: JSONRPCServerAndClient): void {
		for (const method of Object.keys(
			appToSidecarNotifications,
		) as (keyof typeof appToSidecarNotifications)[]) {
			const schema = appToSidecarNotifications[method];
			endpoint.addMethod(method, async (params?: unknown) => {
				const parsed = schema.safeParse(params === undefined ? {} : params);
				if (!parsed.success) {
					throw new JSONRPCErrorException(
						`The ${method} params are not valid`,
						RPC_ERRORS.invalidParams,
						parsed.error.issues,
					);
				}
				const handler = this.deps.notificationHandlers[method] as (
					value: unknown,
				) => void | Promise<void>;
				await handler(parsed.data);
				return null;
			});
		}
	}

	private receiveChunk(
		transport: RpcTransport,
		endpoint: JSONRPCServerAndClient,
		decoder: LineDecoder,
		chunk: string,
	): void {
		if (this.transport !== transport) return;
		for (const decoded of decoder.push(chunk)) {
			if (!decoded.ok) {
				this.logger.warn("A line from the app could not be decoded", {
					code: decoded.error.code,
					reason: decoded.error.message,
				});
				continue;
			}
			void endpoint
				.receiveAndSend(decoded.value, undefined as never, undefined as never)
				.catch((cause: unknown) => {
					this.logger.warn("A message from the app could not be handled", {
						reason: messageOf(cause),
					});
				});
		}
	}
}

function unwrapHandlerValue<K extends keyof typeof appToSidecarRequests>(
	output: AppToSidecarHandlerValue<K>,
): unknown {
	if (isResult(output)) {
		if (!output.ok) throw output.error;
		return output.value;
	}
	return output;
}

function isResult(value: unknown): value is Result<unknown, AppError> {
	return (
		typeof value === "object" &&
		value !== null &&
		"ok" in value &&
		typeof (value as { ok?: unknown }).ok === "boolean"
	);
}

function errorFrom(cause: unknown, method: string): AppError {
	if (cause instanceof JSONRPCErrorException) {
		const code =
			cause.code === LIBRARY_CONNECTION_CLOSED_CODE ? RPC_ERRORS.internalError : cause.code;
		return appError(`rpc_error_${code}`, cause.message, cause.data);
	}
	if (cause instanceof RpcTimeoutError) {
		return appError("rpc_timeout", cause.message);
	}
	return appError("rpc_failed", `The ${method} call to the app failed: ${messageOf(cause)}`, cause);
}

function failureFrom(error: unknown): RpcFailure {
	if (error instanceof JSONRPCErrorException) {
		return { code: error.code, message: error.message, data: error.data };
	}
	if (error instanceof NotImplemented) {
		return {
			code: RPC_ERRORS.notImplemented,
			message: error.message,
			data: { featureId: error.featureId },
		};
	}
	if (isAppError(error)) return { code: codeForAppError(error.code), message: error.message };
	return { code: RPC_ERRORS.internalError, message: messageOf(error) };
}

/** Maps an expected failure to the code the app understands for it. */
export function codeForAppError(code: string): number {
	switch (code) {
		case "session_unknown":
		case "session_not_found":
			return RPC_ERRORS.sessionUnknown;
		case "agent_not_installed":
			return RPC_ERRORS.agentNotInstalled;
		case "agent_auth_required":
			return RPC_ERRORS.agentAuthRequired;
		case "cancelled":
			return RPC_ERRORS.cancelled;
		case "not_implemented":
			return RPC_ERRORS.notImplemented;
		default:
			return RPC_ERRORS.internalError;
	}
}
