/**
 * @feature CHAT-18 JSON-RPC tunnel to the sidecar
 * Behaviour: frontend.md 3c, sessions.md sections 8 and 10.
 * Test first: a request whose result does not match its schema returns Err with code rpc_invalid.
 */
import { idleLiveState, type SessionEventEnvelope } from "@conducted/protocol";
import { appError, err, ok, type Result, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { SidecarTransport } from "../../platform/platform.ts";
import {
	RECONNECT_BACKOFF,
	rpcTimeoutFor,
	type SidecarNotificationHandlers,
	type SidecarRequestHandlers,
	SidecarTunnel,
	type SidecarTunnelDeps,
} from "./tunnel.ts";

const sessionId = "s1" as SessionId;

const envelope: SessionEventEnvelope = {
	sessionId,
	sequence: 0,
	event: {
		type: "turn_ended",
		eventId: "e1" as never,
		at: 1,
		turnId: "t1" as never,
		outcome: "interrupted",
	},
};

interface FakeTransport {
	transport: SidecarTransport;
	sent: string[];
	emitLine(line: string): void;
	emitRestart(): void;
	setResponder(responder: ((message: { id: number }) => void) | null): void;
}

const fakeTransport = (
	ensureStarted: () => Promise<Result<void>> = async () => ok(undefined),
): FakeTransport => {
	let lineListener: ((line: string) => void) | null = null;
	let restartListener: (() => void) | null = null;
	let responder: ((message: { id: number }) => void) | null = null;
	const sent: string[] = [];
	const transport: SidecarTransport = {
		ensureStarted: vi.fn(ensureStarted),
		send: vi.fn(async (line: string) => {
			sent.push(line);
			const message = JSON.parse(line) as { id?: number; method?: string };
			if (message.method !== undefined && message.id !== undefined) {
				const reply = responder;
				if (reply !== null) queueMicrotask(() => reply({ id: message.id as number }));
			}
			return ok(undefined);
		}),
		onLine: (listener) => {
			lineListener = listener;
			return () => {
				lineListener = null;
			};
		},
		onRestart: (listener) => {
			restartListener = listener;
			return () => {
				restartListener = null;
			};
		},
		logPath: async () => "/tmp/sidecar.log",
	};
	return {
		transport,
		sent,
		emitLine: (line) => lineListener?.(line),
		emitRestart: () => restartListener?.(),
		setResponder: (next) => {
			responder = next;
		},
	};
};

const fakeTimers = () => {
	let next = 1;
	const timers = new Map<number, { callback: () => void; ms: number }>();
	return {
		setTimer: (callback: () => void, ms: number): (() => void) => {
			const id = next++;
			timers.set(id, { callback, ms });
			return () => {
				timers.delete(id);
			};
		},
		pending: () => [...timers.values()],
		fire: (ms: number) => {
			for (const [id, timer] of timers) {
				if (timer.ms !== ms) continue;
				timers.delete(id);
				timer.callback();
			}
		},
	};
};

const harness = (
	ensureStarted?: () => Promise<Result<void>>,
	extra: Partial<SidecarTunnelDeps> = {},
) => {
	const fake = fakeTransport(ensureStarted);
	const timers = fakeTimers();
	const log = vi.fn();
	const tunnel = new SidecarTunnel({
		transport: fake.transport,
		requestHandlers: {} as unknown as SidecarRequestHandlers,
		notificationHandlers: {} as unknown as SidecarNotificationHandlers,
		log,
		setTimer: timers.setTimer,
		clock: { now: () => 0 },
		random: () => 0,
		...extra,
	});
	return { fake, timers, log, tunnel };
};

describe("CHAT-18 tunnel", () => {
	it("returns Err with code rpc_invalid when the result does not match its schema", async () => {
		const h = harness();
		h.fake.setResponder((message) =>
			h.fake.emitLine(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })),
		);
		await h.tunnel.start();

		const result = await h.tunnel.request("getSessionStatus", { sessionId });

		expect(result).toMatchObject({ ok: false, error: { code: "rpc_invalid" } });
	});

	it("returns Err with code rpc_invalid for params that fail their schema and sends nothing", async () => {
		const h = harness();
		await h.tunnel.start();

		const result = await h.tunnel.request("getSessionStatus", {} as never);

		expect(result).toMatchObject({ ok: false, error: { code: "rpc_invalid" } });
		expect(h.fake.sent).toEqual([]);
	});

	it("gives each method its own timeout and reports rpc_timeout", async () => {
		const h = harness();
		await h.tunnel.start();

		expect(rpcTimeoutFor("getSessionStatus")).not.toBe(rpcTimeoutFor("cancel"));
		expect(rpcTimeoutFor("getSessionStatus")).toBe(5_000);

		const pending = h.tunnel.request("getSessionStatus", { sessionId });
		await vi.waitFor(() => expect(h.fake.sent).toHaveLength(1));
		expect(h.timers.pending().map((timer) => timer.ms)).toEqual([
			rpcTimeoutFor("getSessionStatus"),
		]);
		h.timers.fire(rpcTimeoutFor("getSessionStatus"));

		await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "rpc_timeout" } });
	});

	it("fails pending requests with sidecar_restarted and announces the new connection", async () => {
		const h = harness();
		await h.tunnel.start();
		const listener = vi.fn();
		h.tunnel.onReconnected(listener);

		const pending = h.tunnel.request("getSessionStatus", { sessionId });
		await vi.waitFor(() => expect(h.fake.sent).toHaveLength(1));
		h.fake.emitRestart();

		await expect(pending).resolves.toMatchObject({
			ok: false,
			error: { code: "sidecar_restarted" },
		});
		await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
		expect(h.fake.transport.ensureStarted).toHaveBeenCalledTimes(2);
	});

	it("keeps serving requests when a reconnect listener throws", async () => {
		const h = harness();
		await h.tunnel.start();
		h.fake.setResponder((message) =>
			h.fake.emitLine(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { known: false } })),
		);
		h.tunnel.onReconnected(() => {
			throw new Error("the listener failed");
		});

		h.fake.emitRestart();
		const result = await h.tunnel.request("getSessionStatus", { sessionId });

		expect(result).toEqual(ok({ known: false }));
		expect(h.log).toHaveBeenCalledWith(
			"error",
			"A sidecar reconnect listener failed",
			expect.anything(),
		);
	});

	it("answers a sidecar request for an unknown method with -32601", async () => {
		const h = harness();
		await h.tunnel.start();

		h.fake.emitLine(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "notAThing", params: {} }));

		await vi.waitFor(() => expect(h.fake.sent).toHaveLength(1));
		const response = JSON.parse(h.fake.sent[0] ?? "{}") as {
			id: number;
			error?: { code: number };
		};
		expect(response.id).toBe(99);
		expect(response.error?.code).toBe(-32601);
	});

	it("answers -32603 and logs when a sidecar request handler throws", async () => {
		const requestHandlers = {
			deliverEvent: vi.fn(async () => {
				throw new Error("store failed");
			}),
		} as unknown as SidecarRequestHandlers;
		const h = harness(undefined, { requestHandlers });
		await h.tunnel.start();

		h.fake.emitLine(
			JSON.stringify({ jsonrpc: "2.0", id: 7, method: "deliverEvent", params: envelope }),
		);

		await vi.waitFor(() => expect(h.fake.sent).toHaveLength(1));
		const response = JSON.parse(h.fake.sent[0] ?? "{}") as {
			id: number;
			error?: { code: number };
		};
		expect(response.id).toBe(7);
		expect(response.error?.code).toBe(-32603);
		expect(h.log).toHaveBeenCalled();
	});

	it("skips a line that is not JSON and still delivers the next one", async () => {
		const liveState = vi.fn(async () => undefined);
		const notificationHandlers = {
			liveState,
		} as unknown as SidecarNotificationHandlers;
		const h = harness(undefined, { notificationHandlers });
		await h.tunnel.start();

		h.fake.emitLine("this is not json");
		h.fake.emitLine(
			JSON.stringify({
				jsonrpc: "2.0",
				method: "liveState",
				params: { sessionId, liveState: idleLiveState },
			}),
		);

		await vi.waitFor(() => expect(liveState).toHaveBeenCalledTimes(1));
		expect(h.log).toHaveBeenCalledWith(
			"warn",
			"A sidecar line is not valid JSON",
			expect.anything(),
		);
	});

	it("waits for start to finish before sending an early request", async () => {
		let release: ((result: Result<void>) => void) | undefined;
		const h = harness(
			() =>
				new Promise<Result<void>>((resolve) => {
					release = resolve;
				}),
		);
		h.fake.setResponder((message) =>
			h.fake.emitLine(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { known: false } })),
		);

		const started = h.tunnel.start();
		const pending = h.tunnel.request("getSessionStatus", { sessionId });
		await Promise.resolve();
		expect(h.fake.sent).toEqual([]);

		release?.(ok(undefined));
		await started;

		await expect(pending).resolves.toEqual({ ok: true, value: { known: false } });
	});

	it("sends a notification and returns Err when its params are not valid", async () => {
		const h = harness();
		await h.tunnel.start();

		const sent = await h.tunnel.notify("setLogLevel", { level: "debug" });
		expect(sent).toEqual(ok(undefined));

		const refused = await h.tunnel.notify("setLogLevel", { level: "loud" } as never);
		expect(refused).toMatchObject({ ok: false, error: { code: "rpc_invalid" } });
		expect(h.fake.sent).toHaveLength(1);
	});
	it("retries a failed reconnect with a growing wait and fails requests meanwhile", async () => {
		let calls = 0;
		const h = harness(async () => {
			calls += 1;
			// Call 1 is the start. Calls 2 and 3 are failed reconnects. Call 4 succeeds.
			return calls === 2 || calls === 3
				? err(appError("sidecar_start_failed", "The sidecar did not start"))
				: ok(undefined);
		});
		await h.tunnel.start();
		const listener = vi.fn();
		h.tunnel.onReconnected(listener);

		h.fake.emitRestart();
		await vi.waitFor(() => expect(h.timers.pending().map((t) => t.ms)).toEqual([500]));
		const early = await h.tunnel.request("getSessionStatus", { sessionId });
		expect(early).toMatchObject({ ok: false, error: { code: "sidecar_start_failed" } });
		expect(listener).not.toHaveBeenCalled();

		h.timers.fire(RECONNECT_BACKOFF.baseMs);
		await vi.waitFor(() => expect(h.timers.pending().map((t) => t.ms)).toEqual([1_000]));

		h.fake.setResponder((message) =>
			h.fake.emitLine(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { known: false } })),
		);
		h.timers.fire(1_000);
		await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
		const served = await h.tunnel.request("getSessionStatus", { sessionId });
		expect(served).toEqual(ok({ known: false }));
		expect(h.timers.pending()).toEqual([]);
	});

	it("schedules no retry when stop comes while a reconnect is waiting for the transport", async () => {
		let release: ((result: Result<void>) => void) | undefined;
		let calls = 0;
		const h = harness(() => {
			calls += 1;
			if (calls === 1) return Promise.resolve(ok(undefined));
			return new Promise<Result<void>>((resolve) => {
				release = resolve;
			});
		});
		await h.tunnel.start();

		h.fake.emitRestart();
		await vi.waitFor(() => expect(release).toBeDefined());
		h.tunnel.stop();
		release?.(err(appError("sidecar_start_failed", "No start")));
		// One turn of the event loop lets every promise the stale reconnect waits on settle.
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(h.timers.pending()).toEqual([]);
	});

	it("does not ask the transport to start again when stop comes before a reconnect begins", async () => {
		let release: ((result: Result<void>) => void) | undefined;
		const h = harness(
			() =>
				new Promise<Result<void>>((resolve) => {
					release = resolve;
				}),
		);
		const started = h.tunnel.start();
		h.fake.emitRestart();
		h.tunnel.stop();
		release?.(ok(undefined));
		await started;
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(h.fake.transport.ensureStarted).toHaveBeenCalledTimes(1);
	});

	it("cancels a waiting retry when stop is called", async () => {
		let calls = 0;
		const h = harness(async () => {
			calls += 1;
			return calls === 1 ? ok(undefined) : err(appError("sidecar_start_failed", "No start"));
		});
		await h.tunnel.start();

		h.fake.emitRestart();
		await vi.waitFor(() => expect(h.timers.pending()).toHaveLength(1));
		h.tunnel.stop();

		expect(h.timers.pending()).toEqual([]);
	});
	it("hands notifications to their handlers in the order the lines arrived", async () => {
		const seen: string[] = [];
		const sessionEvent = vi.fn(async (value: SessionEventEnvelope) => {
			seen.push(value.event.eventId);
		});
		const notificationHandlers = { sessionEvent } as unknown as SidecarNotificationHandlers;
		const h = harness(undefined, { notificationHandlers });
		await h.tunnel.start();

		const expected = Array.from({ length: 25 }, (_value, index) => `event-${index}`);
		for (const eventId of expected) {
			h.fake.emitLine(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "sessionEvent",
					params: { ...envelope, event: { ...envelope.event, eventId } },
				}),
			);
		}

		await vi.waitFor(() => expect(seen).toHaveLength(expected.length));
		expect(seen).toEqual(expected);
	});

	it("keeps lines that arrive before start finishes, in order", async () => {
		const seen: string[] = [];
		const sessionEvent = vi.fn(async (value: SessionEventEnvelope) => {
			seen.push(value.event.eventId);
		});
		const notificationHandlers = { sessionEvent } as unknown as SidecarNotificationHandlers;
		let release: ((result: Result<void>) => void) | undefined;
		const h = harness(
			() =>
				new Promise<Result<void>>((resolve) => {
					release = resolve;
				}),
			{ notificationHandlers },
		);
		const started = h.tunnel.start();
		for (const eventId of ["early-1", "early-2", "early-3"]) {
			h.fake.emitLine(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "sessionEvent",
					params: { ...envelope, event: { ...envelope.event, eventId } },
				}),
			);
		}
		expect(seen).toEqual([]);

		release?.(ok(undefined));
		await started;

		await vi.waitFor(() => expect(seen).toHaveLength(3));
		expect(seen).toEqual(["early-1", "early-2", "early-3"]);
	});
});
