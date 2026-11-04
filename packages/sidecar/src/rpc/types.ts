/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: the typed surface other modules use to talk to the app, and the handler tables the app
 * calls. Both derive from the method tables in packages/protocol/src/rpc.ts, so a change there
 * breaks the compile here.
 * Behaviour: research/conductor/sessions.md section 10 (wire contract, sidecar side) and
 * frontend.md 3c. Method names are ours.
 * Must handle: nothing at runtime; this file only declares types.
 * Test first: none (types only). The peer tests in peer.test.ts cover the behaviour.
 * Our design choice: calls to the app return a Result, so a closed socket or a timeout is a value
 * the caller handles, never a thrown error.
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
import type { AppError, Result } from "@conducted/shared";
import type { z } from "zod";

export type AppToSidecarRequestParams<K extends AppToSidecarRequest> = ParamsOf<
	(typeof appToSidecarRequests)[K]
>;
export type AppToSidecarRequestResult<K extends AppToSidecarRequest> = ResultOf<
	(typeof appToSidecarRequests)[K]
>;
export type AppToSidecarNotificationParams<K extends AppToSidecarNotification> = z.infer<
	(typeof appToSidecarNotifications)[K]
>;
export type SidecarToAppRequestParams<K extends SidecarToAppRequest> = ParamsOf<
	(typeof sidecarToAppRequests)[K]
>;
export type SidecarToAppRequestResult<K extends SidecarToAppRequest> = ResultOf<
	(typeof sidecarToAppRequests)[K]
>;
export type SidecarToAppNotificationParams<K extends SidecarToAppNotification> = z.infer<
	(typeof sidecarToAppNotifications)[K]
>;

/** What the app can call. The session manager and friends implement these. */
export type AppToSidecarHandlers = {
	[K in AppToSidecarRequest]: (
		params: AppToSidecarRequestParams<K>,
	) => Promise<AppToSidecarRequestResult<K>>;
};

/** Notifications from the app. They have no reply, so handlers return nothing. */
export type AppToSidecarNotificationHandlers = {
	[K in AppToSidecarNotification]: (params: AppToSidecarNotificationParams<K>) => void;
};

/** The sidecar's view of the app. Every module that talks to the UI takes this as a parameter. */
export interface SidecarToApp {
	/** True while an app connection is attached. Events still go to the write-ahead log when false. */
	readonly connected: boolean;
	request<K extends SidecarToAppRequest>(
		method: K,
		params: SidecarToAppRequestParams<K>,
		options?: { timeoutMs?: number },
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>>;
	/** Fire and forget. Returns false when no app is connected. */
	notify<K extends SidecarToAppNotification>(
		method: K,
		params: SidecarToAppNotificationParams<K>,
	): boolean;
	/** Calls `listener` each time a connection attaches. Returns the function that removes it. */
	onAttach(listener: () => void): () => void;
	/** Calls `listener` each time the connection closes. Returns the function that removes it. */
	onDetach(listener: () => void): () => void;
}
