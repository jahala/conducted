/**
 * @feature SIDE-02 JSON-RPC over a Unix socket
 * Owns: the contract test of FakeApp. One list of messages goes through the real RpcPeer and
 * through FakeApp, and both must give the same verdict: delivered, or refused with the same code.
 * Test first: "a notification the real peer refuses, the fake refuses too".
 */
import { describe, expect, test } from "bun:test";
import {
	appToSidecarNotifications,
	appToSidecarRequests,
	type SidecarToAppNotification,
	type SidecarToAppRequest,
} from "@conducted/protocol";
import { type AppError, ok, type Result, systemClock } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import { encodeLine, LineDecoder } from "../rpc/ndjson.ts";
import { RpcPeer, type RpcTransport } from "../rpc/peer.ts";
import type { AppToSidecarHandlers, AppToSidecarNotificationHandlers } from "../rpc/types.ts";
import { DEFAULT_APP_REPLIES, FakeApp } from "./fake-app.ts";

/** The app end of the wire: it records what the sidecar sends and answers requests with `answer`. */
class ScriptedAppTransport implements RpcTransport {
	readonly sent: { method: string; id?: number | string }[] = [];
	private dataListener: ((chunk: string) => void) | null = null;
	private readonly decoder = new LineDecoder();

	constructor(private readonly answer: (method: string) => unknown) {}

	writeLine(line: string): void {
		for (const decoded of this.decoder.push(line)) {
			if (!decoded.ok) continue;
			const message = decoded.value as { method: string; id?: number | string };
			this.sent.push(
				message.id === undefined
					? { method: message.method }
					: { method: message.method, id: message.id },
			);
			if (message.id === undefined) continue;
			const reply = encodeLine({
				jsonrpc: "2.0",
				id: message.id,
				result: this.answer(message.method),
			});
			queueMicrotask(() => this.dataListener?.(reply));
		}
	}

	onData(listener: (chunk: string) => void): void {
		this.dataListener = listener;
	}

	onClose(_listener: () => void): void {}

	close(): void {}
}

function realPeer(answer: (method: string) => unknown): {
	peer: RpcPeer;
	wire: ScriptedAppTransport;
} {
	const handlers = {} as Record<string, () => Promise<never>>;
	for (const method of Object.keys(appToSidecarRequests)) {
		handlers[method] = async () => {
			throw new Error(`Unexpected request in this test: ${method}`);
		};
	}
	const notificationHandlers = {} as Record<string, () => void>;
	for (const method of Object.keys(appToSidecarNotifications))
		notificationHandlers[method] = () => {};
	const peer = new RpcPeer({
		handlers: handlers as unknown as AppToSidecarHandlers,
		notificationHandlers: notificationHandlers as unknown as AppToSidecarNotificationHandlers,
		logger: createLogger({ sink: () => {}, clock: systemClock, level: "error", scope: "contract" }),
	});
	const wire = new ScriptedAppTransport(answer);
	peer.attach(wire);
	return { peer, wire };
}

const sessionId = "session-1";
const validEnvelope = {
	sessionId,
	sequence: 0,
	event: { type: "turn_ended", eventId: "event-1", at: 1, turnId: "turn-1", outcome: "success" },
};

type NotificationCase = {
	name: string;
	method: SidecarToAppNotification;
	params: unknown;
	delivered: boolean;
};

const notificationCases: NotificationCase[] = [
	{
		name: "a live state with a known status",
		method: "liveState",
		params: {
			sessionId,
			liveState: {
				status: "idle",
				pendingSteerIds: [],
				backgroundTasks: [],
				fastModeAvailable: true,
			},
		},
		delivered: true,
	},
	{
		name: "a live state with a status that does not exist",
		method: "liveState",
		params: {
			sessionId,
			liveState: {
				status: "paused",
				pendingSteerIds: [],
				backgroundTasks: [],
				fastModeAvailable: true,
			},
		},
		delivered: false,
	},
	{ name: "a valid session event", method: "sessionEvent", params: validEnvelope, delivered: true },
	{
		name: "a session event with an empty event id",
		method: "sessionEvent",
		params: { ...validEnvelope, event: { ...validEnvelope.event, eventId: "" } },
		delivered: false,
	},
	{
		name: "a session event with a fractional sequence",
		method: "sessionEvent",
		params: { ...validEnvelope, sequence: 1.5 },
		delivered: false,
	},
	{
		name: "an agent session id",
		method: "agentSessionId",
		params: { sessionId, agentSessionId: "agent-1" },
		delivered: true,
	},
	{
		name: "an agent session id notification with no id",
		method: "agentSessionId",
		params: { sessionId },
		delivered: false,
	},
];

type RequestCase = {
	name: string;
	method: SidecarToAppRequest;
	params: unknown;
	/** What the app answers. Default: the valid answer of DEFAULT_APP_REPLIES. */
	answer?: unknown;
	verdict: "ok" | "rpc_invalid_params" | "rpc_invalid_result";
};

const requestCases: RequestCase[] = [
	{
		name: "a valid diff request",
		method: "getWorkspaceDiff",
		params: { sessionId, statOnly: false },
		verdict: "ok",
	},
	{ name: "a valid event delivery", method: "deliverEvent", params: validEnvelope, verdict: "ok" },
	{
		name: "an event delivery whose event is not valid",
		method: "deliverEvent",
		params: { ...validEnvelope, event: { type: "turn_ended" } },
		verdict: "rpc_invalid_params",
	},
	{
		name: "adding no diff comments at all",
		method: "addDiffComments",
		params: { sessionId, comments: [] },
		verdict: "rpc_invalid_params",
	},
	{
		name: "an app answer that does not fit the result schema",
		method: "deliverEvent",
		params: validEnvelope,
		answer: { persisted: "yes" },
		verdict: "rpc_invalid_result",
	},
];

function codeOf(result: Result<unknown, AppError>): "ok" | string {
	return result.ok ? "ok" : result.error.code;
}

describe("SIDE-02 FakeApp against the real RpcPeer", () => {
	for (const item of notificationCases) {
		test(`a notification the real peer refuses, the fake refuses too: ${item.name}`, () => {
			const { peer, wire } = realPeer(() => ({}));
			const fake = new FakeApp({ onRefused: "return" });

			const real = peer.notify(item.method, item.params as never);
			const stand = fake.notify(item.method, item.params as never);

			expect(real).toBe(item.delivered);
			expect(stand).toBe(item.delivered);
			expect(wire.sent.map((entry) => entry.method)).toEqual(item.delivered ? [item.method] : []);
			expect(fake.notifications.length).toBe(item.delivered ? 1 : 0);
			expect(fake.refused.length).toBe(item.delivered ? 0 : 1);
		});
	}

	for (const item of requestCases) {
		test(`a request the real peer refuses, the fake refuses with the same code: ${item.name}`, async () => {
			const answer = item.answer ?? DEFAULT_APP_REPLIES[item.method]();
			const { peer } = realPeer(() => answer);
			const fake = new FakeApp({ onRefused: "return" });
			fake.reply = () => ok(answer);

			const real = await peer.request(item.method, item.params as never);
			const stand = await fake.request(item.method, item.params as never);

			expect(codeOf(real)).toBe(item.verdict);
			expect(codeOf(stand)).toBe(item.verdict);
		});
	}

	test("a disconnected app gives false for a notification and app_not_connected for a request", async () => {
		const peer = new RpcPeer({
			handlers: {} as AppToSidecarHandlers,
			notificationHandlers: {} as AppToSidecarNotificationHandlers,
			logger: createLogger({
				sink: () => {},
				clock: systemClock,
				level: "error",
				scope: "contract",
			}),
		});
		const fake = new FakeApp();
		fake.connected = false;
		const params = { sessionId, statOnly: false };

		expect(peer.notify("agentSessionId", { sessionId, agentSessionId: "a" } as never)).toBe(false);
		expect(fake.notify("agentSessionId", { sessionId, agentSessionId: "a" } as never)).toBe(false);
		expect(codeOf(await peer.request("getWorkspaceDiff", params as never))).toBe(
			"app_not_connected",
		);
		expect(codeOf(await fake.request("getWorkspaceDiff", params as never))).toBe(
			"app_not_connected",
		);
	});
});

describe("SIDE-02 FakeApp refusals", () => {
	test("by default a message the real peer would refuse throws, so the test cannot miss it", () => {
		const fake = new FakeApp();

		expect(() => fake.notify("sessionEvent", { ...validEnvelope, sequence: -1 } as never)).toThrow(
			"sessionEvent",
		);
		expect(fake.notifications).toEqual([]);
		expect(fake.refused).toHaveLength(1);
	});

	test("a request with bad params rejects, and nothing is recorded as sent", async () => {
		const fake = new FakeApp();

		await expect(
			fake.request("addDiffComments", { sessionId, comments: [] } as never),
		).rejects.toThrow("addDiffComments");
		expect(fake.requests).toEqual([]);
	});

	test("a held request waits for the test and its answer is checked too", async () => {
		const fake = new FakeApp({ holdRequests: true, onRefused: "return" });

		const pending = fake.request("deliverEvent", validEnvelope as never);
		fake.answerNext({ persisted: 3 });

		expect(codeOf(await pending)).toBe("rpc_invalid_result");
		expect(fake.maxActiveRequests).toBe(1);
	});
});
