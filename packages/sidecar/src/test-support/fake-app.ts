/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: the one stand-in for the app that every sidecar test uses (SidecarToApp). It records what
 * the sidecar sends and checks each message against the protocol schemas that the real RpcPeer
 * uses, so a test that sends something the real peer would refuse fails.
 * Behaviour: rpc/peer.ts. The same schemas judge the same messages; test-support/fake-app.test.ts
 * runs both on one list of messages and compares the verdicts.
 * Contract test: fake-app.test.ts
 * Must handle: a notification or request whose params fail their schema (the real peer returns
 * false or an `rpc_invalid_params` error; this fake throws by default so the test cannot miss it),
 * a reply that fails the result schema (`rpc_invalid_result` on the real peer), a disconnected app
 * (notify gives false, request gives `app_not_connected`), and requests that wait for the test.
 * Test first: fake-app.test.ts, "a notification the real peer refuses, the fake refuses too".
 * Our design choice: with `onRefused: "return"` the fake answers exactly like the real peer does
 * (false or an error value) and still records the refusal in `refused`.
 */
import {
	type SidecarToAppNotification,
	type SidecarToAppRequest,
	sidecarToAppNotifications,
	sidecarToAppRequests,
} from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type {
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "../rpc/types.ts";

export interface RecordedRequest {
	method: SidecarToAppRequest;
	params: unknown;
	options?: { timeoutMs?: number };
}

export interface RecordedNotification {
	method: SidecarToAppNotification;
	params: unknown;
}

/** A message the real peer would have refused. */
export interface Refusal {
	direction: "notification" | "request params" | "request result";
	method: string;
	issues: readonly unknown[];
}

export type FakeAppReply = (
	method: SidecarToAppRequest,
	params: unknown,
) => Result<unknown, AppError> | Promise<Result<unknown, AppError>>;

export interface FakeAppOptions {
	/** "throw" (default) fails the test where the bad message is sent. "return" answers like the real peer. */
	onRefused?: "throw" | "return";
	/** Requests wait until the test calls answerNext, failNext or rejectNext. */
	holdRequests?: boolean;
}

/** A valid answer for each request, used when a test sets no reply of its own. */
export const DEFAULT_APP_REPLIES: {
	[K in SidecarToAppRequest]: () => SidecarToAppRequestResult<K>;
} = {
	requestInteraction: () => ({ kind: "withdrawn" }),
	deliverEvent: () => ({ persisted: true }),
	getWorkspaceDiff: () => ({ diff: "" }),
	getDiffComments: () => ({ comments: [] }),
	addDiffComments: () => ({ added: 0 }),
	getTerminalOutput: () => ({ output: "", source: "auto", running: false }),
	setTargetBranch: () => ({ ok: true, message: "" }),
};

interface HeldRequest {
	method: SidecarToAppRequest;
	settle(result: Result<unknown, AppError>): void;
	reject(cause: unknown): void;
}

export class FakeApp implements SidecarToApp {
	connected = true;
	readonly requests: RecordedRequest[] = [];
	readonly notifications: RecordedNotification[] = [];
	readonly refused: Refusal[] = [];
	/** The most requests that were waiting for an answer at the same moment. */
	maxActiveRequests = 0;
	/** Answers a request. The default gives each method its entry in DEFAULT_APP_REPLIES. */
	reply: FakeAppReply = (method) => ok(DEFAULT_APP_REPLIES[method]());
	/** Runs after a request is recorded and before it is answered. */
	beforeReply: ((method: SidecarToAppRequest, params: unknown) => Promise<void>) | null = null;
	holdRequests: boolean;

	private readonly onRefused: "throw" | "return";
	private readonly held: HeldRequest[] = [];
	private activeRequests = 0;
	private readonly attachListeners = new Set<() => void>();
	private readonly detachListeners = new Set<() => void>();

	constructor(options: FakeAppOptions = {}) {
		this.onRefused = options.onRefused ?? "throw";
		this.holdRequests = options.holdRequests ?? false;
	}

	async request<K extends SidecarToAppRequest>(
		method: K,
		params: SidecarToAppRequestParams<K>,
		options?: { timeoutMs?: number },
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		if (!this.connected) {
			return err(appError("app_not_connected", "The app is not connected"));
		}
		const parsed = sidecarToAppRequests[method].params.safeParse(params);
		if (!parsed.success) {
			const refusal: Refusal = {
				direction: "request params",
				method,
				issues: parsed.error.issues,
			};
			this.refuse(refusal);
			return err(
				appError("rpc_invalid_params", `The ${method} params are not valid`, parsed.error),
			);
		}
		this.requests.push(options === undefined ? { method, params } : { method, params, options });
		this.activeRequests += 1;
		this.maxActiveRequests = Math.max(this.maxActiveRequests, this.activeRequests);
		try {
			if (this.beforeReply !== null) await this.beforeReply(method, params);
			const answer = this.holdRequests
				? await new Promise<Result<unknown, AppError>>((resolve, reject) => {
						this.held.push({ method, settle: resolve, reject });
					})
				: await this.reply(method, params);
			return this.checkedResult(method, answer) as Result<SidecarToAppRequestResult<K>, AppError>;
		} finally {
			this.activeRequests -= 1;
		}
	}

	notify<K extends SidecarToAppNotification>(
		method: K,
		params: SidecarToAppNotificationParams<K>,
	): boolean {
		if (!this.connected) return false;
		const parsed = sidecarToAppNotifications[method].safeParse(params);
		if (!parsed.success) {
			this.refuse({ direction: "notification", method, issues: parsed.error.issues });
			return false;
		}
		this.notifications.push({ method, params });
		return true;
	}

	onAttach(listener: () => void): () => void {
		this.attachListeners.add(listener);
		return () => this.attachListeners.delete(listener);
	}

	onDetach(listener: () => void): () => void {
		this.detachListeners.add(listener);
		return () => this.detachListeners.delete(listener);
	}

	/** Connects the app and tells the attach listeners, as the real peer does. */
	attach(): void {
		this.connected = true;
		for (const listener of this.attachListeners) listener();
	}

	/** Disconnects the app and tells the detach listeners, as the real peer does. */
	detach(): void {
		this.connected = false;
		for (const listener of this.detachListeners) listener();
	}

	/** Answers the oldest held request. The answer must fit the method's result schema. */
	answerNext(value: unknown): void {
		this.held.shift()?.settle(ok(value));
	}

	/** Fails the oldest held request with an error value, as the real peer does for a closed socket. */
	failNext(error: AppError): void {
		this.held.shift()?.settle(err(error));
	}

	/**
	 * Rejects the oldest held request. The real peer never rejects; this exists to test a caller
	 * that defends against it.
	 */
	rejectNext(cause: unknown): void {
		this.held.shift()?.reject(cause);
	}

	/** The params of every notification sent with this method, in order. */
	notified<K extends SidecarToAppNotification>(method: K): SidecarToAppNotificationParams<K>[] {
		return this.notifications
			.filter((entry) => entry.method === method)
			.map((entry) => entry.params as SidecarToAppNotificationParams<K>);
	}

	/** The params of every request sent with this method, in order. */
	requested<K extends SidecarToAppRequest>(method: K): SidecarToAppRequestParams<K>[] {
		return this.requests
			.filter((entry) => entry.method === method)
			.map((entry) => entry.params as SidecarToAppRequestParams<K>);
	}

	private checkedResult(
		method: SidecarToAppRequest,
		answer: Result<unknown, AppError>,
	): Result<unknown, AppError> {
		if (!answer.ok) return answer;
		const validated = sidecarToAppRequests[method].result.safeParse(answer.value);
		if (validated.success) return answer;
		this.refuse({ direction: "request result", method, issues: validated.error.issues });
		return err(
			appError("rpc_invalid_result", `The ${method} answer is not valid`, validated.error),
		);
	}

	private refuse(refusal: Refusal): void {
		this.refused.push(refusal);
		if (this.onRefused === "return") return;
		throw new Error(
			`The real peer would refuse this ${refusal.direction} (${refusal.method}): ${JSON.stringify(refusal.issues)}`,
		);
	}
}
