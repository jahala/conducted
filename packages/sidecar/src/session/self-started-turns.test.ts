import { describe, expect, test } from "bun:test";
import type {
	AgentMessage,
	LiveState,
	SessionEvent,
	SidecarToAppNotification,
	SidecarToAppRequest,
} from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import type { AppError, Result, SessionId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import type { ProcessManager } from "../process/process-manager.ts";
import type {
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "../rpc/types.ts";
import type { AgentSession } from "../runners/runner.ts";
import type { EventPublisher } from "./event-batcher.ts";
import { beginTurn, LiveStateStore } from "./live-state.ts";
import { RunGuard, type RunNumber } from "./run-guard.ts";
import { SelfStartedTurns } from "./self-started-turns.ts";

const sid = (value: string) => value as SessionId;

class FakeApp implements SidecarToApp {
	connected = true;
	readonly notifications: { method: SidecarToAppNotification; params: unknown }[] = [];

	async request<K extends SidecarToAppRequest>(
		_method: K,
		_params: SidecarToAppRequestParams<K>,
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		return ok({} as SidecarToAppRequestResult<K>);
	}

	notify<K extends SidecarToAppNotification>(
		method: K,
		params: SidecarToAppNotificationParams<K>,
	): boolean {
		if (!this.connected) return false;
		this.notifications.push({ method, params });
		return true;
	}

	onAttach(_listener: () => void): () => void {
		return () => {};
	}

	onDetach(_listener: () => void): () => void {
		return () => {};
	}
}

class FakePublisher implements EventPublisher {
	readonly events: { sessionId: SessionId; event: SessionEvent }[] = [];
	readonly order: string[];

	constructor(order: string[]) {
		this.order = order;
	}

	publish(sessionId: SessionId, event: SessionEvent): void {
		this.events.push({ sessionId, event });
		this.order.push(`event:${event.type}`);
	}

	async flush(_sessionId: SessionId): Promise<void> {
		this.order.push("flush");
	}

	onWriteFailure(_listener: (sessionId: SessionId, message: string) => void): void {}
}

class FakeProcesses implements ProcessManager {
	readonly busy: string[] = [];
	readonly idle: string[] = [];

	async claimActive(_key: string, _start: () => Promise<AgentSession>): Promise<never> {
		throw new Error("not used by this test");
	}

	async ensureWarm(_key: string, _start: () => Promise<AgentSession>): Promise<void> {}

	markBusy(key: string): void {
		this.busy.push(key);
	}

	markIdle(key: string): void {
		this.idle.push(key);
	}

	setBackgroundTasks(_key: string, _hasTasks: boolean): void {}

	async disconnect(_key: string): Promise<void> {}

	async sweep(): Promise<void> {}

	async stopAll(): Promise<void> {}
}

function agentMessage(text: string): AgentMessage {
	return { agent: "claude", items: [{ kind: "text", text }] };
}

interface Harness {
	turns: SelfStartedTurns;
	app: FakeApp;
	publisher: FakePublisher;
	processes: FakeProcesses;
	liveState: LiveStateStore;
	runGuard: RunGuard;
	settled: RunNumber[];
	order: string[];
}

function harness(): Harness {
	const order: string[] = [];
	const app = new FakeApp();
	const publisher = new FakePublisher(order);
	const processes = new FakeProcesses();
	const runGuard = new RunGuard();
	const liveState = new LiveStateStore({
		app,
		flushed: async () => {
			order.push("store-flush");
		},
	});
	const settled: RunNumber[] = [];
	let nextId = 0;
	const turns = new SelfStartedTurns({
		liveState,
		publisher,
		processes,
		runGuard,
		clock: { now: () => 1000 },
		ids: { uuid: () => `id-${++nextId}` },
		logger: createLogger({
			sink: () => {},
			clock: { now: () => 1000 },
			level: "debug",
			scope: "test",
		}),
		processKey: "claude:s1",
		onSettled: (run) => settled.push(run),
	});
	return { turns, app, publisher, processes, liveState, runGuard, settled, order };
}

describe("AGENT-15 self-started turns host side", () => {
	test("AGENT-15 work started by itself marks an idle chat working, and the end marks it idle", async () => {
		const h = harness();
		const sessionId = sid("s1");

		await h.turns.onInProgressChanged(sessionId, true);
		expect(h.liveState.get(sessionId).status).toBe("working");
		expect(h.processes.busy).toEqual(["claude:s1"]);

		await h.turns.onInProgressChanged(sessionId, false, { outcome: "success" });
		expect(h.liveState.get(sessionId).status).toBe("idle");
		expect(h.processes.idle).toEqual(["claude:s1"]);
	});

	test("AGENT-15 a chat with a turn of ours is left to that turn", async () => {
		const h = harness();
		const sessionId = sid("s1");
		await h.liveState.update(sessionId, beginTurn);

		await h.turns.onInProgressChanged(sessionId, true);

		expect(h.liveState.get(sessionId).status).toBe("working");
		expect(h.publisher.events).toEqual([]);
		expect(h.processes.busy).toEqual([]);
	});

	test("AGENT-15 the messages are stored under one system turn that ends with turn_ended", async () => {
		const h = harness();
		const sessionId = sid("s1");

		await h.turns.onInProgressChanged(sessionId, true);
		h.turns.onMessage(sessionId, agentMessage("background task done"));
		await h.turns.onInProgressChanged(sessionId, false, { outcome: "success" });

		const events = h.publisher.events.map((entry) => entry.event);
		expect(events.map((event) => event.type)).toEqual(["agent", "turn_ended"]);
		const turnIds = new Set(events.map((event) => event.turnId));
		expect(turnIds.size).toBe(1);
		expect(events.some((event) => event.type === "user_message")).toBe(false);
		expect(events[0]?.type === "agent" ? events[0].message : null).toEqual(
			agentMessage("background task done"),
		);
		expect(events[1]).toMatchObject({ type: "turn_ended", outcome: "success" });
		expect(h.settled).toHaveLength(1);
	});

	test("AGENT-15 a turn_ended is followed by the flush and then idle", async () => {
		const h = harness();
		const sessionId = sid("s1");

		await h.turns.onInProgressChanged(sessionId, true);
		await h.turns.onInProgressChanged(sessionId, false, { outcome: "success" });

		const ended = h.order.indexOf("event:turn_ended");
		const flushed = h.order.indexOf("flush");
		const idle = h.order.lastIndexOf("store-flush");
		expect(ended).toBeGreaterThanOrEqual(0);
		expect(flushed).toBeGreaterThan(ended);
		expect(idle).toBeGreaterThan(flushed);
		expect(h.liveState.get(sessionId)).toEqual(idleLiveState);
	});

	test("AGENT-15 a report after the chat was reset is dropped", async () => {
		const h = harness();
		const sessionId = sid("s1");
		await h.turns.onInProgressChanged(sessionId, true);
		const published = h.publisher.events.length;

		h.runGuard.invalidate();
		h.liveState.drop(sessionId);
		await h.turns.onInProgressChanged(sessionId, false, { outcome: "success" });

		expect(h.publisher.events.length).toBe(published);
		expect(h.liveState.get(sessionId)).toEqual(idleLiveState);
		expect(h.settled).toEqual([]);
	});

	test("AGENT-15 a message while our own turn runs is ignored", async () => {
		const h = harness();
		const sessionId = sid("s1");
		await h.liveState.update(sessionId, beginTurn);

		h.turns.onMessage(sessionId, agentMessage("ours"));

		expect(h.publisher.events).toEqual([]);
	});

	test("AGENT-15 a repeated start does not begin a second system turn", async () => {
		const h = harness();
		const sessionId = sid("s1");

		await h.turns.onInProgressChanged(sessionId, true);
		await h.turns.onInProgressChanged(sessionId, true);
		h.turns.onMessage(sessionId, agentMessage("one"));
		await h.turns.onInProgressChanged(sessionId, false, { outcome: "success" });

		expect(h.publisher.events.map((entry) => entry.event.type)).toEqual(["agent", "turn_ended"]);
		expect(h.processes.busy).toEqual(["claude:s1"]);
	});

	test("AGENT-15 a message with no start still opens one system turn", async () => {
		const h = harness();
		const sessionId = sid("s1");

		h.turns.onMessage(sessionId, agentMessage("late wake"));
		await h.turns.onInProgressChanged(sessionId, false, { outcome: "success" });

		const events = h.publisher.events.map((entry) => entry.event);
		expect(events.map((event) => event.type)).toEqual(["agent", "turn_ended"]);
		expect(h.liveState.get(sessionId).status).toBe("idle");
	});

	test("AGENT-15 a stream that died is stored as interrupted, not success", async () => {
		const h = harness();
		const sessionId = sid("s1");

		await h.turns.onInProgressChanged(sessionId, true);
		await h.turns.onInProgressChanged(sessionId, false, { outcome: "interrupted" });

		const ended = h.publisher.events.find((entry) => entry.event.type === "turn_ended")?.event;
		expect(ended).toMatchObject({ type: "turn_ended", outcome: "interrupted" });
		expect(h.liveState.get(sessionId).error).toBeUndefined();
	});

	test("AGENT-15 a crashed stream stores the error outcome and its message", async () => {
		const h = harness();
		const sessionId = sid("s1");

		await h.turns.onInProgressChanged(sessionId, true);
		await h.turns.onInProgressChanged(sessionId, false, {
			outcome: "error",
			error: "the CLI exited",
		});

		const ended = h.publisher.events.find((entry) => entry.event.type === "turn_ended")?.event;
		expect(ended).toMatchObject({
			type: "turn_ended",
			outcome: "error",
			error: "the CLI exited",
		});
		expect(h.liveState.get(sessionId)).toMatchObject({ status: "idle", error: "the CLI exited" });
	});

	test("AGENT-15 an end with no reported outcome is not claimed as success", async () => {
		const h = harness();
		const sessionId = sid("s1");

		await h.turns.onInProgressChanged(sessionId, true);
		await h.turns.onInProgressChanged(sessionId, false);

		const ended = h.publisher.events.find((entry) => entry.event.type === "turn_ended")?.event;
		expect(ended).toMatchObject({ type: "turn_ended", outcome: "interrupted" });
	});

	test("AGENT-15 an end without a start changes nothing", async () => {
		const h = harness();
		const sessionId = sid("s1");

		await h.turns.onInProgressChanged(sessionId, false);

		expect(h.publisher.events).toEqual([]);
		expect(h.liveState.get(sessionId)).toEqual(idleLiveState);
		expect(h.processes.idle).toEqual([]);
	});

	test("AGENT-15 live state extras of the chat are kept", async () => {
		const h = harness();
		const sessionId = sid("s1");
		const previous: LiveState = {
			...idleLiveState,
			fastModeAvailable: false,
			backgroundTasks: [{ id: "task-1", kind: "shell", description: "tests" }],
		};
		await h.liveState.update(sessionId, () => previous);

		await h.turns.onInProgressChanged(sessionId, true);

		const next = h.liveState.get(sessionId);
		expect(next.fastModeAvailable).toBe(false);
		expect(next.backgroundTasks).toEqual(previous.backgroundTasks);
	});
});
