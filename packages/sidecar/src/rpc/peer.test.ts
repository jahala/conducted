import { describe, expect, test } from "bun:test";
import {
	appToSidecarNotifications,
	appToSidecarRequests,
	idleLiveState,
} from "@conducted/protocol";
import { appError, type InteractionId, type SessionId, systemClock } from "@conducted/shared";
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import { encodeLine, LineDecoder } from "./ndjson.ts";
import { RpcPeer, type RpcTransport } from "./peer.ts";
import type { AppToSidecarHandlers, AppToSidecarNotificationHandlers } from "./types.ts";

class MemoryTransport implements RpcTransport {
	other: MemoryTransport | null = null;
	private readonly dataListeners: ((chunk: string) => void)[] = [];
	private readonly closeListeners: (() => void)[] = [];
	private closed = false;

	writeLine(line: string): void {
		if (this.closed) return;
		this.other?.receive(line);
	}

	onData(listener: (chunk: string) => void): void {
		this.dataListeners.push(listener);
	}

	onClose(listener: () => void): void {
		this.closeListeners.push(listener);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const listener of this.closeListeners) listener();
	}

	private receive(line: string): void {
		if (this.closed) return;
		for (const listener of this.dataListeners) listener(line);
	}
}

function transportPair(): { side: MemoryTransport; app: MemoryTransport } {
	const side = new MemoryTransport();
	const app = new MemoryTransport();
	side.other = app;
	app.other = side;
	return { side, app };
}

function logger() {
	return createLogger({
		sink: () => {},
		clock: systemClock,
		level: "error",
		scope: "rpc-test",
	});
}

function requestHandlers(overrides: Partial<AppToSidecarHandlers> = {}): AppToSidecarHandlers {
	const table = {} as Record<string, (params: unknown) => Promise<unknown>>;
	for (const method of Object.keys(appToSidecarRequests)) {
		table[method] = async () => {
			throw new Error(`Unexpected request in this test: ${method}`);
		};
	}
	Object.assign(table, overrides);
	return table as AppToSidecarHandlers;
}

function notificationHandlers(
	overrides: Partial<AppToSidecarNotificationHandlers> = {},
): AppToSidecarNotificationHandlers {
	const table = {} as Record<string, (params: unknown) => void>;
	for (const method of Object.keys(appToSidecarNotifications)) table[method] = () => {};
	Object.assign(table, overrides);
	return table as AppToSidecarNotificationHandlers;
}

interface AppHarness {
	peer: JSONRPCServerAndClient;
	received: { method: string; params: unknown }[];
}

function appHarness(
	wire: MemoryTransport,
	options: {
		requests?: Record<string, (params: unknown) => unknown>;
		notifications?: Record<string, (params: unknown) => void>;
	} = {},
): AppHarness {
	const received: { method: string; params: unknown }[] = [];
	const server = new JSONRPCServer({ errorListener: () => {} });
	for (const [method, handler] of Object.entries(options.requests ?? {})) {
		server.addMethod(method, handler);
	}
	for (const [method, handler] of Object.entries(options.notifications ?? {})) {
		server.addMethod(method, (params: unknown) => {
			received.push({ method, params });
			handler(params);
		});
	}
	const client = new JSONRPCClient((payload) => {
		wire.writeLine(encodeLine(payload));
	});
	const peer = new JSONRPCServerAndClient(server, client, { errorListener: () => {} });
	const decoder = new LineDecoder();
	wire.onData((chunk) => {
		for (const decoded of decoder.push(chunk)) {
			if (decoded.ok) {
				void peer.receiveAndSend(decoded.value, undefined, undefined);
			}
		}
	});
	return { peer, received };
}

function sidePeer(
	overrides: Partial<AppToSidecarHandlers> = {},
	notifications: Partial<AppToSidecarNotificationHandlers> = {},
): RpcPeer {
	return new RpcPeer({
		handlers: requestHandlers(overrides),
		notificationHandlers: notificationHandlers(notifications),
		logger: logger(),
	});
}

function never<T>(): Promise<T> {
	return new Promise<T>(() => {});
}

async function rejectionOf(value: PromiseLike<unknown>): Promise<unknown> {
	try {
		await value;
		throw new Error("The call did not fail");
	} catch (cause) {
		return cause;
	}
}

const sid = (value: string): SessionId => value as SessionId;
const iid = (value: string): InteractionId => value as InteractionId;

describe("SIDE-02 JSON-RPC peer: calls from the app", () => {
	test("SIDE-02 bad params get invalidParams and the handler is not called", async () => {
		const { side, app } = transportPair();
		const calls: string[] = [];
		const peer = sidePeer({
			cancel: async () => {
				calls.push("cancel");
				return { wasWorking: false, droppedMessageIds: [] };
			},
		});
		peer.attach(side);
		const appSide = appHarness(app);
		const failure = await rejectionOf(appSide.peer.request("cancel", {}));
		expect(failure).toMatchObject({ code: -32602 });
		expect(calls).toEqual([]);
	});

	test("SIDE-02 a handler that is a placeholder answers notImplemented with its feature id", async () => {
		const { side, app } = transportPair();
		const peer = sidePeer({
			cancel: async () => {
				const { notImplemented } = await import("@conducted/shared");
				return notImplemented("SIDE-02");
			},
		});
		peer.attach(side);
		const appSide = appHarness(app);
		const failure = await rejectionOf(
			appSide.peer.request("cancel", { sessionId: sid("session-1") }),
		);
		expect(failure).toMatchObject({ code: -32001, data: { featureId: "SIDE-02" } });
	});

	test("SIDE-02 an expected failure uses our own error code", async () => {
		const { side, app } = transportPair();
		const peer = sidePeer({
			cancel: async () => {
				throw appError("session_unknown", "The sidecar does not know this chat");
			},
		});
		peer.attach(side);
		const appSide = appHarness(app);
		const failure = await rejectionOf(
			appSide.peer.request("cancel", { sessionId: sid("session-1") }),
		);
		expect(failure).toMatchObject({ code: -32002 });
	});

	test("SIDE-02 a handler result that fails its schema answers internalError", async () => {
		const { side, app } = transportPair();
		const peer = sidePeer({
			cancel: async () => ({ wasWorking: "yes" }) as never,
		});
		peer.attach(side);
		const appSide = appHarness(app);
		const failure = await rejectionOf(
			appSide.peer.request("cancel", { sessionId: sid("session-1") }),
		);
		expect(failure).toMatchObject({ code: -32603 });
	});

	test("SIDE-02 an app notification with bad params reaches no handler", async () => {
		const { side, app } = transportPair();
		const calls: string[] = [];
		const peer = sidePeer(
			{},
			{
				eventPersisted: async () => {
					calls.push("eventPersisted");
				},
			},
		);
		peer.attach(side);
		const appSide = appHarness(app);
		appSide.peer.notify("eventPersisted", {});
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(calls).toEqual([]);
	});
});

describe("SIDE-02 JSON-RPC peer: logging", () => {
	test("SIDE-02 server and client errors are logged under the FrontendRpcTunnel tag", async () => {
		const { side, app } = transportPair();
		const records: LogRecord[] = [];
		const logger = createLogger({
			sink: (record) => records.push(record),
			clock: systemClock,
			level: "warn",
			scope: "rpc-test",
		});
		const peer = new RpcPeer({
			handlers: requestHandlers(),
			notificationHandlers: notificationHandlers(),
			logger,
		});
		peer.attach(side);

		app.writeLine("not json\n");
		app.writeLine('{"hello":"world"}\n');
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(records.length).toBeGreaterThanOrEqual(3);
		expect(records.every((record) => record.scope === "rpc-test:FrontendRpcTunnel")).toBe(true);
		expect(records.some((record) => record.message.includes("could not be decoded"))).toBe(true);
		expect(records.some((record) => record.message.includes("invalid JSON-RPC"))).toBe(true);
		expect(records.some((record) => record.message.includes("could not be handled"))).toBe(true);
	});
});

describe("SIDE-02 JSON-RPC peer: messages from the sidecar", () => {
	test("SIDE-02 a request waits for the app's answer", async () => {
		const { side, app } = transportPair();
		const peer = sidePeer();
		peer.attach(side);
		appHarness(app, {
			requests: { getWorkspaceDiff: () => ({ diff: "the diff" }) },
		});
		await expect(
			peer.request("getWorkspaceDiff", { sessionId: sid("session-1"), statOnly: false }),
		).resolves.toEqual({ ok: true, value: { diff: "the diff" } });
	});

	test("SIDE-02 a notification reaches the app", () => {
		const { side, app } = transportPair();
		const peer = sidePeer();
		peer.attach(side);
		const appSide = appHarness(app, {
			notifications: { liveState: () => {} },
		});
		expect(
			peer.notify("liveState", { sessionId: sid("session-1"), liveState: idleLiveState }),
		).toBe(true);
		expect(appSide.received).toHaveLength(1);
		expect(appSide.received[0]?.method).toBe("liveState");
	});

	test("SIDE-02 notify returns false while no app is attached", () => {
		const peer = sidePeer();
		expect(peer.connected).toBe(false);
		expect(
			peer.notify("liveState", { sessionId: sid("session-1"), liveState: idleLiveState }),
		).toBe(false);
	});

	test("SIDE-02 a request while no app is attached returns an error value", async () => {
		const peer = sidePeer();
		const result = await peer.request("getWorkspaceDiff", {
			sessionId: sid("session-1"),
			statOnly: false,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("app_not_connected");
	});
});

describe("SIDE-02 JSON-RPC peer: reconnect and timeouts", () => {
	test("SIDE-02 attaching a new connection rejects the old connection's pending requests", async () => {
		const first = transportPair();
		const peer = sidePeer();
		peer.attach(first.side);
		appHarness(first.app, { requests: { getWorkspaceDiff: () => never() } });
		const pending = peer.request("getWorkspaceDiff", {
			sessionId: sid("session-1"),
			statOnly: false,
		});
		const next = new MemoryTransport();
		peer.attach(next);
		const result = await pending;
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("rpc_error_-32603");
		expect(peer.connected).toBe(true);
	});

	test("SIDE-02 detaching rejects pending requests", async () => {
		const { side, app } = transportPair();
		const peer = sidePeer();
		peer.attach(side);
		appHarness(app, { requests: { getWorkspaceDiff: () => never() } });
		const pending = peer.request("getWorkspaceDiff", {
			sessionId: sid("session-1"),
			statOnly: false,
		});
		peer.detach();
		const result = await pending;
		expect(result.ok).toBe(false);
		expect(peer.connected).toBe(false);
	});

	test("SIDE-02 a normal request times out and the timeout is an error value", async () => {
		const { side, app } = transportPair();
		const peer = sidePeer();
		peer.attach(side);
		appHarness(app, { requests: { getWorkspaceDiff: () => never() } });
		const result = await peer.request(
			"getWorkspaceDiff",
			{ sessionId: sid("session-1"), statOnly: false },
			{ timeoutMs: 5 },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("rpc_timeout");
	});

	test("SIDE-02 requestInteraction has no timeout even when one is passed", async () => {
		const { side, app } = transportPair();
		const peer = sidePeer();
		peer.attach(side);
		appHarness(app, { requests: { requestInteraction: () => never() } });
		const pending = peer.request(
			"requestInteraction",
			{
				sessionId: sid("session-1"),
				interactionId: iid("interaction-1"),
				interaction: {
					kind: "question",
					questions: [{ question: "Which one?", options: [], multiSelect: false }],
				},
			},
			{ timeoutMs: 5 },
		);
		const raced = await Promise.race([
			pending,
			new Promise<string>((resolve) => setTimeout(() => resolve("still pending"), 30)),
		]);
		expect(raced).toBe("still pending");
		peer.detach();
		const result = await pending;
		expect(result.ok).toBe(false);
	});
});
