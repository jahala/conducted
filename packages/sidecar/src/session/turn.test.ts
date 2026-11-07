import { describe, expect, test } from "bun:test";
import type { AgentMessage, LiveState, SessionConfig, WorkspaceContext } from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import type { MessageId, SessionId, TurnId } from "@conducted/shared";
import type {
	CheckpointOutcome,
	CheckpointRequest,
	CheckpointService,
} from "../checkpoints/checkpoint-service.ts";
import { createLogger } from "../logging/logger.ts";
import type { SidecarToApp } from "../rpc/types.ts";
import type { AgentSession, TurnCallbacks, TurnInput, TurnOutcome } from "../runners/runner.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import { FakeInteractions } from "../test-support/fake-interactions.ts";
import { FakePublisher } from "../test-support/fake-publisher.ts";
import { until } from "../test-support/until.ts";
import { LiveStateStore } from "./live-state.ts";
import {
	MEMORY_EXHAUSTED_MESSAGE,
	type MemoryExhaustionProbe,
	type MemoryIncident,
} from "./memory-exhaustion.ts";
import { RunGuard as Guard, type RunGuard, type RunNumber } from "./run-guard.ts";
import { Turn, type TurnDeps, type TurnRequest } from "./turn.ts";

const sid = (value: string) => value as SessionId;
const mid = (value: string) => value as MessageId;
const tid = (value: string) => value as TurnId;
const sessionId = sid("session-1");

function baseConfig(): SessionConfig {
	return {
		agent: "claude",
		model: "sonnet",
		effort: "medium",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
	};
}

function workspace(path: string): WorkspaceContext {
	return {
		workspaceId: "workspace-1" as WorkspaceContext["workspaceId"],
		workspaceName: "alpha",
		workspacePath: path,
		repoRootPath: "/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		host: { kind: "local" },
		port: 4100,
	};
}

function request(overrides: Partial<TurnRequest> = {}): TurnRequest {
	return {
		sessionId,
		messageId: mid("message-1"),
		turnId: tid("turn-1"),
		text: "hello",
		agentText: "agent: hello",
		attachmentPaths: [],
		config: baseConfig(),
		workspace: workspace("/work/alpha"),
		...overrides,
	};
}

function agentMessage(text: string): AgentMessage {
	return { agent: "claude", items: [{ kind: "text", text }] };
}

class RecordingLiveState extends LiveStateStore {
	private readonly states = new Map<SessionId, LiveState>();
	readonly order: string[];

	constructor(order: string[]) {
		super({ app: {} as unknown as SidecarToApp, flushed: async () => {} });
		this.order = order;
	}

	override get(id: SessionId): LiveState {
		return this.states.get(id) ?? idleLiveState;
	}

	override async update(id: SessionId, reducer: (state: LiveState) => LiveState): Promise<void> {
		const next = reducer(this.get(id));
		this.states.set(id, next);
		this.order.push(`state:${next.status}`);
	}

	override drop(id: SessionId): void {
		this.states.delete(id);
	}
}

class FakeCheckpoints implements CheckpointService {
	readonly starts: CheckpointRequest[] = [];
	readonly ends: CheckpointRequest[] = [];
	startGate: Promise<void> | null = null;
	startOutcome: CheckpointOutcome = {};
	endOutcome: CheckpointOutcome = {};

	async start(request: CheckpointRequest): Promise<CheckpointOutcome> {
		this.starts.push(request);
		if (this.startGate !== null) await this.startGate;
		return this.startOutcome;
	}

	async end(request: CheckpointRequest): Promise<CheckpointOutcome> {
		if (this.startGate !== null) await this.startGate;
		this.ends.push(request);
		return this.endOutcome;
	}
}

class FakeAgentSession implements AgentSession {
	callbacks: TurnCallbacks | null = null;
	input: TurnInput | null = null;
	runCalls = 0;
	cancelCalls = 0;
	private readonly result: Promise<TurnOutcome>;
	private resolveResult!: (outcome: TurnOutcome) => void;
	private rejectResult!: (cause: unknown) => void;

	constructor(readonly sessionId: SessionId) {
		this.result = new Promise<TurnOutcome>((resolve, reject) => {
			this.resolveResult = resolve;
			this.rejectResult = reject;
		});
	}

	runTurn(input: TurnInput, callbacks: TurnCallbacks): Promise<TurnOutcome> {
		this.runCalls += 1;
		this.input = input;
		this.callbacks = callbacks;
		return this.result;
	}

	async steer(): Promise<{ consumed: Promise<void> }> {
		return { consumed: Promise.resolve() };
	}

	async cancel(): Promise<void> {
		this.cancelCalls += 1;
	}

	async applyConfig(): Promise<"applied" | "restart"> {
		return "applied";
	}

	async contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return null;
	}

	async dispose(): Promise<void> {}

	resolve(outcome: TurnOutcome): void {
		this.resolveResult(outcome);
	}

	reject(cause: unknown): void {
		this.rejectResult(cause);
	}
}

class ProbeForTurn implements MemoryExhaustionProbe {
	startCount: number | undefined;
	failureCount: number | undefined;
	incident: MemoryIncident | undefined;
	countCalls = 0;
	incidentCalls = 0;

	async oomKillCount(): Promise<number | undefined> {
		this.countCalls += 1;
		return this.countCalls === 1 ? this.startCount : this.failureCount;
	}

	async recentIncident(): Promise<MemoryIncident | undefined> {
		this.incidentCalls += 1;
		return this.incident;
	}
}

interface Harness {
	turn: Turn;
	agent: FakeAgentSession;
	checkpoints: FakeCheckpoints;
	publisher: FakePublisher;
	liveState: LiveStateStore;
	interactions: FakeInteractions;
	runGuard: RunGuard;
	memory: ProbeForTurn | undefined;
	order: string[];
	settledRuns: RunNumber[];
	agentSessionIds: string[];
	backgroundFlags: boolean[];
}

function harness(
	options: {
		startGate?: Promise<void>;
		runGuard?: RunGuard;
		liveState?: LiveStateStore;
		memory?: ProbeForTurn;
	} = {},
): Harness {
	const order: string[] = [];
	const agent = new FakeAgentSession(sessionId);
	const checkpoints = new FakeCheckpoints();
	checkpoints.startGate = options.startGate ?? null;
	checkpoints.startOutcome = { checkpointId: "checkpoint-start" as never };
	checkpoints.endOutcome = {
		checkpointId: "checkpoint-end" as never,
		changes: [{ path: "a.ts", status: "modified", linesAdded: 2, linesRemoved: 1, binary: false }],
	};
	const publisher = new FakePublisher(order);
	const liveState = options.liveState ?? new RecordingLiveState(order);
	const interactions = new FakeInteractions();
	const runGuard = options.runGuard ?? new Guard();
	const settledRuns: RunNumber[] = [];
	const agentSessionIds: string[] = [];
	const backgroundFlags: boolean[] = [];
	let nextId = 0;
	const deps: TurnDeps = {
		agent,
		runGuard,
		publisher,
		liveState,
		interactions,
		checkpoints,
		clock: { now: () => 1000 },
		ids: { uuid: () => `event-${++nextId}` },
		logger: createLogger({
			sink: () => {},
			clock: { now: () => 1000 },
			level: "debug",
			scope: "test",
		}),
		onAgentSessionId: (id) => agentSessionIds.push(id),
		onTurnSettled: (run) => settledRuns.push(run),
		onBackgroundTasks: (hasTasks) => backgroundFlags.push(hasTasks),
		...(options.memory === undefined ? {} : { memory: options.memory }),
	};
	return {
		turn: new Turn(deps, request()),
		agent,
		checkpoints,
		publisher,
		liveState,
		interactions,
		runGuard,
		memory: options.memory,
		order,
		settledRuns,
		agentSessionIds,
		backgroundFlags,
	};
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("SIDE-04 start and event order", () => {
	test("SIDE-04 user_message, start checkpoint, agent, end checkpoint, turn_ended, flush, idle", async () => {
		const gate = deferred();
		const h = harness({ startGate: gate.promise });

		const run = await h.turn.start();
		expect(h.agent.runCalls).toBe(1);
		expect(h.agent.input).toEqual({
			text: "agent: hello",
			attachmentPaths: [],
			config: baseConfig(),
		});

		gate.resolve();
		await until(() => h.order.includes("event:checkpoint:start"), "the start checkpoint event");

		h.agent.callbacks?.onMessage(agentMessage("from the agent"));
		h.agent.resolve({ kind: "success" });
		expect(await h.turn.settled()).toEqual({ kind: "success" });

		expect(h.order).toEqual([
			"event:user_message",
			"state:working",
			"event:checkpoint:start",
			"event:agent",
			"event:checkpoint:end",
			"event:turn_ended",
			"flush",
			"state:idle",
		]);
		expect(run).toBe(1 as typeof run);
	});

	test("SIDE-04 start returns when the runner has been called, not when the turn ends", async () => {
		const h = harness();
		const run = await h.turn.start();

		expect(run).toBe(1 as typeof run);
		expect(h.agent.runCalls).toBe(1);
		expect(h.order).toContain("event:user_message");
		expect(h.order).not.toContain("event:turn_ended");

		h.agent.resolve({ kind: "success" });
		expect(await h.turn.settled()).toEqual({ kind: "success" });
	});

	test("SIDE-04 the user message has no state field and sets the chat working", async () => {
		const h = harness();
		await h.turn.start();

		const userMessage = h.publisher.events.find(
			({ event }) => event.type === "user_message",
		)?.event;
		expect(userMessage).toMatchObject({
			type: "user_message",
			messageId: mid("message-1"),
			turnId: tid("turn-1"),
			text: "hello",
			delivery: "new_turn",
		});
		expect(userMessage).not.toHaveProperty("state");
		expect(h.liveState.get(sessionId).status).toBe("working");

		h.agent.resolve({ kind: "success" });
		await h.turn.settled();
	});

	test("SIDE-04 the checkpoint outcomes become checkpoint events", async () => {
		const h = harness();
		await h.turn.start();
		h.agent.resolve({ kind: "success" });
		await h.turn.settled();

		const checkpoints = h.publisher.events
			.map(({ event }) => event)
			.filter((event) => event.type === "checkpoint");
		expect(checkpoints).toHaveLength(2);
		expect(checkpoints[0]).toMatchObject({
			phase: "start",
			checkpointId: "checkpoint-start",
		});
		expect(checkpoints[1]).toMatchObject({
			phase: "end",
			checkpointId: "checkpoint-end",
			changes: [
				{ path: "a.ts", status: "modified", linesAdded: 2, linesRemoved: 1, binary: false },
			],
		});
	});
});

describe("SIDE-04 turn end outcomes", () => {
	test("SIDE-04 a failed turn sets the live-state error and emits turn_ended error", async () => {
		const h = harness();
		await h.turn.start();
		h.agent.resolve({ kind: "error", message: "agent crashed", retryable: false });

		expect(await h.turn.settled()).toEqual({
			kind: "error",
			message: "agent crashed",
			retryable: false,
		});

		const ended = h.publisher.events.find(({ event }) => event.type === "turn_ended")?.event;
		expect(ended).toMatchObject({ outcome: "error", error: "agent crashed" });
		expect(h.liveState.get(sessionId)).toMatchObject({
			status: "idle",
			error: "agent crashed",
		});
	});

	test("CLOUD-04 a memory incident shows the fixed out-of-memory message", async () => {
		const memory = new ProbeForTurn();
		memory.incident = {
			kind: "workspace_memory_exhausted",
			occurredAtMs: 1000,
			trigger: "crash",
			phase: "killed",
		};
		const h = harness({ memory });
		await h.turn.start();
		h.agent.resolve({
			kind: "error",
			message: "Claude Code process exited with code 137",
			retryable: false,
		});

		expect(await h.turn.settled()).toEqual({
			kind: "error",
			message: MEMORY_EXHAUSTED_MESSAGE,
			retryable: false,
		});
		const ended = h.publisher.events.find(({ event }) => event.type === "turn_ended")?.event;
		expect(ended).toMatchObject({ outcome: "error", error: MEMORY_EXHAUSTED_MESSAGE });
		expect(h.liveState.get(sessionId)).toMatchObject({
			status: "idle",
			error: MEMORY_EXHAUSTED_MESSAGE,
		});
	});

	test("CLOUD-04 a rising oom_kill count shows the fixed out-of-memory message", async () => {
		const memory = new ProbeForTurn();
		memory.startCount = 4;
		memory.failureCount = 5;
		const h = harness({ memory });
		await h.turn.start();
		h.agent.resolve({ kind: "error", message: "agent killed", retryable: false });

		expect(await h.turn.settled()).toEqual({
			kind: "error",
			message: MEMORY_EXHAUSTED_MESSAGE,
			retryable: false,
		});
		expect(memory.incidentCalls).toBe(1);
	});

	test("CLOUD-04 an unchanged oom_kill count and no incident keeps the raw error", async () => {
		const memory = new ProbeForTurn();
		memory.startCount = 4;
		memory.failureCount = 4;
		const h = harness({ memory });
		await h.turn.start();
		h.agent.resolve({ kind: "error", message: "agent crashed", retryable: false });

		expect(await h.turn.settled()).toEqual({
			kind: "error",
			message: "agent crashed",
			retryable: false,
		});
	});

	test("CLOUD-04 a cancelled turn keeps the user's cancel, not a memory message", async () => {
		const memory = new ProbeForTurn();
		memory.incident = {
			kind: "workspace_memory_exhausted",
			occurredAtMs: 1000,
			trigger: "crash",
			phase: "killed",
		};
		const h = harness({ memory });
		await h.turn.start();
		h.agent.resolve({ kind: "cancelled" });

		expect(await h.turn.settled()).toEqual({ kind: "cancelled" });
		expect(h.liveState.get(sessionId).error).toBe("aborted by user");
		expect(memory.incidentCalls).toBe(0);
	});

	test("SIDE-04 a runner that rejects ends the turn with an error outcome", async () => {
		const h = harness();
		await h.turn.start();
		h.agent.reject(new Error("the agent fell over"));

		expect(await h.turn.settled()).toEqual({
			kind: "error",
			message: "the agent fell over",
			retryable: false,
		});
		expect(h.liveState.get(sessionId).error).toBe("the agent fell over");
	});

	test("SIDE-04 a runner that reports cancelled goes idle as interrupted by the user", async () => {
		const h = harness();
		await h.turn.start();
		h.agent.resolve({ kind: "cancelled" });

		expect(await h.turn.settled()).toEqual({ kind: "cancelled" });

		const ended = h.publisher.events.find(({ event }) => event.type === "turn_ended")?.event;
		expect(ended).toMatchObject({ outcome: "cancelled" });
		expect(h.liveState.get(sessionId)).toMatchObject({
			status: "idle",
			error: "aborted by user",
		});
	});

	test("SIDE-04 the turn reports itself settled once and wakes the manager", async () => {
		const h = harness();
		const run = await h.turn.start();
		h.agent.resolve({ kind: "success" });
		await h.turn.settled();

		expect(h.settledRuns).toEqual([run]);
	});
});

describe("SIDE-04 cancel and stale runs", () => {
	test("SIDE-04 cancel stops the runner, ends cancelled, and makes the run stale", async () => {
		const h = harness();
		const run = await h.turn.start();
		expect(h.runGuard.isCurrent(run)).toBe(true);

		await h.turn.cancel();

		expect(h.agent.cancelCalls).toBe(1);
		expect(h.runGuard.isCurrent(run)).toBe(false);
		expect(await h.turn.settled()).toEqual({ kind: "cancelled" });
		expect(h.checkpoints.ends).toHaveLength(1);

		const ended = h.publisher.events.find(({ event }) => event.type === "turn_ended")?.event;
		expect(ended).toMatchObject({ outcome: "cancelled" });
		expect(h.liveState.get(sessionId)).toMatchObject({
			status: "idle",
			error: "aborted by user",
		});
	});

	test("SIDE-04 a late success after cancel is dropped", async () => {
		const h = harness();
		await h.turn.start();
		await h.turn.cancel();
		const published = h.publisher.events.length;

		h.agent.resolve({ kind: "success" });
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(h.publisher.events).toHaveLength(published);
		expect(await h.turn.settled()).toEqual({ kind: "cancelled" });
	});

	test("SIDE-04 a late agent message after cancel is dropped", async () => {
		const h = harness();
		await h.turn.start();
		const callbacks = h.agent.callbacks;
		await h.turn.cancel();
		const published = h.publisher.events.length;

		callbacks?.onMessage(agentMessage("too late"));

		expect(h.publisher.events).toHaveLength(published);
	});

	test("SIDE-04 cancel during the start checkpoint lets it finish, then ends the turn", async () => {
		const gate = deferred();
		const h = harness({ startGate: gate.promise });
		await h.turn.start();

		const cancelling = h.turn.cancel();
		await until(() => h.agent.cancelCalls === 1, "the runner to be stopped");
		expect(h.checkpoints.ends).toHaveLength(0);

		gate.resolve();
		await cancelling;

		expect(h.checkpoints.starts).toHaveLength(1);
		expect(h.checkpoints.ends).toHaveLength(1);
		expect(h.order.indexOf("event:checkpoint:start")).toBeLessThan(
			h.order.indexOf("event:checkpoint:end"),
		);
		expect(await h.turn.settled()).toEqual({ kind: "cancelled" });
	});

	test("SIDE-04 a newer run makes the older run's late message stale", async () => {
		const runGuard = new Guard();
		const first = harness({ runGuard });
		const firstRun = await first.turn.start();
		const firstCallbacks = first.agent.callbacks;

		const second = harness({ runGuard });
		const secondRun = await second.turn.start();
		const published = first.publisher.events.length;

		firstCallbacks?.onMessage(agentMessage("from the replaced run"));

		expect(first.publisher.events).toHaveLength(published);
		expect(runGuard.isCurrent(firstRun)).toBe(false);
		expect(runGuard.isCurrent(secondRun)).toBe(true);

		first.agent.resolve({ kind: "success" });
		second.agent.resolve({ kind: "success" });
		await first.turn.settled();
		await second.turn.settled();
	});
});

describe("SIDE-04 runner callbacks", () => {
	test("SIDE-04 interactions and background tasks reach their owners for the current run", async () => {
		const h = harness();
		await h.turn.start();
		const callbacks = h.agent.callbacks;
		if (callbacks === null) throw new Error("The runner did not receive callbacks");

		callbacks.onAgentSessionId("agent-session-1");
		callbacks.onBackgroundTasks([{ id: "task-1", kind: "shell", description: "tests" }]);
		await callbacks.requestInteraction({
			kind: "plan_approval",
			plan: "a plan",
		});

		expect(h.agentSessionIds).toEqual(["agent-session-1"]);
		expect(h.liveState.get(sessionId).backgroundTasks).toEqual([
			{ id: "task-1", kind: "shell", description: "tests" },
		]);
		expect(h.interactions.opened).toHaveLength(1);

		h.agent.resolve({ kind: "success" });
		await h.turn.settled();
	});

	test("SIDE-07 open background tasks reach the process manager's hook, and so does the end of the last one", async () => {
		const h = harness();
		await h.turn.start();
		const callbacks = h.agent.callbacks;
		if (callbacks === null) throw new Error("The runner did not receive callbacks");

		callbacks.onBackgroundTasks([{ id: "task-1", kind: "shell", description: "tests" }]);
		callbacks.onBackgroundTasks([]);

		expect(h.backgroundFlags).toEqual([true, false]);

		h.agent.resolve({ kind: "success" });
		await h.turn.settled();
	});

	test("SIDE-07 a replaced run's background report does not reach the hook", async () => {
		const runGuard = new Guard();
		const h = harness({ runGuard });
		await h.turn.start();
		const callbacks = h.agent.callbacks;
		if (callbacks === null) throw new Error("The runner did not receive callbacks");

		runGuard.start();
		callbacks.onBackgroundTasks([{ id: "task-1", kind: "shell", description: "tests" }]);

		expect(h.backgroundFlags).toEqual([]);

		h.agent.resolve({ kind: "success" });
		await h.turn.settled();
	});

	test("SIDE-04 beforeFirstWrite waits for the start checkpoint", async () => {
		const gate = deferred();
		const h = harness({ startGate: gate.promise });
		await h.turn.start();
		const callbacks = h.agent.callbacks;
		if (callbacks === null) throw new Error("The runner did not receive callbacks");

		let written = false;
		const waiting = callbacks.beforeFirstWrite().then(() => {
			written = true;
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(written).toBe(false);

		gate.resolve();
		await waiting;
		expect(written).toBe(true);
		expect(h.checkpoints.starts).toHaveLength(1);

		h.agent.resolve({ kind: "success" });
		await h.turn.settled();
	});
});

describe("SIDE-05 waiting since from the runner callback", () => {
	test("SIDE-05 a background-task callback sets waitingSince and a notification carries it", async () => {
		const app = new FakeApp();
		const liveState = new LiveStateStore({ app, flushed: async () => {} });
		const h = harness({ liveState });
		await h.turn.start();
		const callbacks = h.agent.callbacks;
		if (callbacks === null) throw new Error("The runner did not receive callbacks");
		const tasks = [{ id: "task-1", kind: "shell" as const, description: "tests" }];

		callbacks.onBackgroundTasks(tasks, 1234);
		await until(() => liveState.get(sessionId).waitingSince === 1234, "waitingSince");

		const notification = app.notifications.filter((item) => item.method === "liveState").at(-1);
		const params = notification?.params as { liveState: LiveState } | undefined;
		expect(params?.liveState.waitingSince).toBe(1234);
		expect(params?.liveState.backgroundTasks).toEqual(tasks);

		callbacks.onBackgroundTasks(tasks, undefined);
		await until(
			() => liveState.get(sessionId).waitingSince === undefined,
			"the blocking wait to clear",
		);

		h.agent.resolve({ kind: "success" });
		await h.turn.settled();
	});
});
