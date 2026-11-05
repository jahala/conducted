import { describe, expect, test } from "bun:test";
import type {
	Interaction,
	InteractionAnswer,
	InteractionRequest,
	LiveState,
	ModelInfo,
	SessionConfig,
	SessionEvent,
	SidecarToAppNotification,
	SidecarToAppRequest,
	WorkspaceContext,
} from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import type { AgentKind, AppError, MessageId, Result, SessionId, TurnId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import type {
	CheckpointOutcome,
	CheckpointRequest,
	CheckpointService,
} from "../checkpoints/checkpoint-service.ts";
import { createLogger, type Logger } from "../logging/logger.ts";
import { FileEventOutbox } from "../outbox/event-outbox.ts";
import type { OutboxStorage } from "../outbox/outbox-file.ts";
import type { ProcessLease, ProcessManager } from "../process/process-manager.ts";
import type { PromptAssembler, PromptInput } from "../prompt/assemble.ts";
import type {
	SidecarToApp,
	SidecarToAppNotificationParams,
	SidecarToAppRequestParams,
	SidecarToAppRequestResult,
} from "../rpc/types.ts";
import { SteerRevertedError } from "../runners/errors.ts";
import type { RunnerRegistry } from "../runners/registry.ts";
import type {
	AgentSession,
	Runner,
	RunnerCapabilities,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runners/runner.ts";
import type { CapturedShellEnv, ShellEnvProvider } from "../shell-env/capture.ts";
import { BatchingEventPublisher, type EventPublisher } from "./event-batcher.ts";
import type { InteractionBroker } from "./interactions.ts";
import { beginTurn, endTurn, LiveStateStore } from "./live-state.ts";
import {
	DefaultSessionManager,
	type SessionManagerDeps,
	type SessionTurn,
	type TurnFactory,
} from "./manager.ts";
import type { RunNumber } from "./run-guard.ts";
import { KeyedSerialQueue } from "./serial-queue.ts";
import type { TurnDeps, TurnRequest } from "./turn.ts";

const sid = (value: string) => value as SessionId;
const mid = (value: string) => value as MessageId;
const tid = (value: string) => value as TurnId;

function baseConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
	return {
		agent: "claude",
		model: "sonnet",
		effort: "medium",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
		...overrides,
	};
}

function workspace(path: string, overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
	return {
		workspaceId: "workspace-1" as WorkspaceContext["workspaceId"],
		workspaceName: "alpha",
		workspacePath: path,
		repoRootPath: "/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 4100,
		...overrides,
	};
}

function launch() {
	return { env: {}, providerKeys: {} };
}

function model(id: string, isDefault = false): ModelInfo {
	return {
		id,
		label: id,
		status: "picker",
		isNew: false,
		isDefault,
		efforts: [],
		defaultEffort: "medium",
		effortAxis: "effort",
		liveEffortChange: false,
		supportsFastMode: false,
	};
}

class InMemoryOutboxStorage implements OutboxStorage {
	private readonly files = new Map<string, string>();

	async list() {
		return ok([...this.files.keys()]);
	}

	async read(fileName: string) {
		return ok(this.files.get(fileName) ?? null);
	}

	async writeAtomic(fileName: string, text: string) {
		this.files.set(fileName, text);
		return ok(undefined);
	}

	async moveToTrash(fileName: string) {
		this.files.delete(fileName);
		return ok(undefined);
	}

	async cleanTempFiles() {
		return ok(0);
	}
}

class FakeApp implements SidecarToApp {
	connected = true;
	readonly requests: { method: SidecarToAppRequest; params: unknown }[] = [];
	readonly notifications: { method: SidecarToAppNotification; params: unknown }[] = [];

	async request<K extends SidecarToAppRequest>(
		method: K,
		params: SidecarToAppRequestParams<K>,
	): Promise<Result<SidecarToAppRequestResult<K>, AppError>> {
		this.requests.push({ method, params });
		return ok({ kind: "withdrawn" } as SidecarToAppRequestResult<K>);
	}

	notify<K extends SidecarToAppNotification>(
		method: K,
		params: SidecarToAppNotificationParams<K>,
	): boolean {
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

class TestLiveState extends LiveStateStore {
	private readonly states = new Map<SessionId, LiveState>();

	constructor(app: SidecarToApp) {
		super({ app, flushed: async () => {} });
	}

	override get(sessionId: SessionId): LiveState {
		return this.states.get(sessionId) ?? idleLiveState;
	}

	override async update(
		sessionId: SessionId,
		reducer: (state: LiveState) => LiveState,
	): Promise<void> {
		this.states.set(sessionId, reducer(this.get(sessionId)));
	}

	override drop(sessionId: SessionId): void {
		this.states.delete(sessionId);
	}

	set(sessionId: SessionId, state: LiveState): void {
		this.states.set(sessionId, state);
	}
}

class FakeAgentSession implements AgentSession {
	steerError: unknown = null;
	consumed: Promise<void> = Promise.resolve();
	applyResult: "applied" | "restart" = "applied";
	onCancel: (() => void) | null = null;
	steerCalls = 0;
	cancelCalls = 0;
	disposeCalls = 0;
	readonly appliedConfigs: SessionConfig[] = [];
	readonly autoApprove: boolean[] = [];

	constructor(readonly sessionId: SessionId) {}

	async runTurn(_input: TurnInput, _callbacks: TurnCallbacks): Promise<TurnOutcome> {
		return { kind: "success" };
	}

	async steer(_input: TurnInput): Promise<{ consumed: Promise<void> }> {
		this.steerCalls += 1;
		if (this.steerError !== null) throw this.steerError;
		return { consumed: this.consumed };
	}

	async cancel(): Promise<void> {
		this.cancelCalls += 1;
		this.onCancel?.();
	}

	async applyConfig(config: SessionConfig): Promise<"applied" | "restart"> {
		this.appliedConfigs.push(config);
		return this.applyResult;
	}

	async contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return null;
	}

	async dispose(): Promise<void> {
		this.disposeCalls += 1;
	}

	setAutoApproveEdits(enabled: boolean): void {
		this.autoApprove.push(enabled);
	}
}

class FakeRunner implements Runner {
	readonly started: StartOptions[] = [];
	readonly capabilities: RunnerCapabilities;
	readonly models: ModelInfo[];

	constructor(
		readonly agent: AgentKind,
		capabilities: Partial<RunnerCapabilities> = {},
		models: ModelInfo[] = [model("sonnet", true)],
	) {
		this.capabilities = {
			steer: true,
			interrupt: true,
			resumeAt: true,
			liveConfig: true,
			slashCommands: true,
			mcpServers: true,
			contextUsage: true,
			...capabilities,
		};
		this.models = models;
	}

	async detect(_env: Readonly<Record<string, string>>): Promise<null> {
		return null;
	}

	async start(options: StartOptions): Promise<AgentSession> {
		this.started.push(options);
		return new FakeAgentSession(options.sessionId);
	}

	async listModels(): Promise<ModelInfo[]> {
		return this.models;
	}

	async listSlashCommands(
		_workspacePath: string,
	): Promise<{ name: string; description: string }[]> {
		return [];
	}
}

class FakeProcesses implements ProcessManager {
	readonly agents = new Map<string, AgentSession>();
	readonly disconnected: string[] = [];
	stopAllCalls = 0;

	async claimActive(key: string, start: () => Promise<AgentSession>): Promise<ProcessLease> {
		let agent = this.agents.get(key);
		if (agent === undefined) {
			agent = await start();
			this.agents.set(key, agent);
		}
		return { key, agent, release: () => {} };
	}

	async ensureWarm(key: string, start: () => Promise<AgentSession>): Promise<void> {
		if (this.agents.has(key)) return;
		this.agents.set(key, await start());
	}

	markBusy(_key: string): void {}

	markIdle(_key: string): void {}

	setBackgroundTasks(_key: string, _hasTasks: boolean): void {}

	async disconnect(key: string): Promise<void> {
		this.disconnected.push(key);
		const agent = this.agents.get(key);
		this.agents.delete(key);
		await agent?.dispose();
	}

	async sweep(): Promise<void> {}

	async stopAll(): Promise<void> {
		this.stopAllCalls += 1;
		for (const agent of this.agents.values()) await agent.dispose();
		this.agents.clear();
	}
}

class FakePrompt implements PromptAssembler {
	readonly inputs: PromptInput[] = [];
	gate: Promise<void> | null = null;

	async assemble(input: PromptInput): Promise<Result<string, AppError>> {
		this.inputs.push(input);
		if (this.gate !== null) await this.gate;
		return ok(`agent:${input.text}`);
	}
}

class FakePublisher implements EventPublisher {
	readonly events: { sessionId: SessionId; event: SessionEvent }[] = [];

	publish(sessionId: SessionId, event: SessionEvent): void {
		this.events.push({ sessionId, event });
	}

	async flush(_sessionId: SessionId): Promise<void> {}

	onWriteFailure(_listener: (sessionId: SessionId, message: string) => void): void {}
}

class FakeInteractions implements InteractionBroker {
	readonly withdrawn: SessionId[] = [];
	readonly openRequests = new Map<SessionId, InteractionRequest>();
	answerResult = { accepted: true, superseded: false };

	async open(_sessionId: SessionId, _interaction: Interaction): Promise<InteractionAnswer> {
		return { kind: "withdrawn" };
	}

	answer(
		_sessionId: SessionId,
		_interactionId: InteractionRequest["interactionId"],
		_answer: InteractionAnswer,
	): { accepted: boolean; superseded: boolean } {
		return this.answerResult;
	}

	withdrawAll(sessionId: SessionId): void {
		this.withdrawn.push(sessionId);
	}

	openRequest(sessionId: SessionId): InteractionRequest | undefined {
		return this.openRequests.get(sessionId);
	}
}

class FakeCheckpoints implements CheckpointService {
	readonly starts: unknown[] = [];
	readonly ends: unknown[] = [];

	async start(request: CheckpointRequest): Promise<CheckpointOutcome> {
		this.starts.push(request);
		return {};
	}

	async end(request: CheckpointRequest): Promise<CheckpointOutcome> {
		this.ends.push(request);
		return {};
	}
}

class FakeTurn implements SessionTurn {
	run: RunNumber | null = null;
	private readonly settledPromise: Promise<TurnOutcome>;
	private resolveSettled!: (outcome: TurnOutcome) => void;

	constructor(
		readonly deps: TurnDeps,
		readonly request: TurnRequest,
	) {
		this.settledPromise = new Promise((resolve) => {
			this.resolveSettled = resolve;
		});
	}

	async start(): Promise<RunNumber> {
		this.run = this.deps.runGuard.start();
		await this.deps.liveState.update(this.request.sessionId, beginTurn);
		return this.run;
	}

	settled(): Promise<TurnOutcome> {
		return this.settledPromise;
	}

	async cancel(): Promise<void> {
		this.deps.runGuard.invalidate();
		await this.deps.liveState.update(this.request.sessionId, (live) =>
			endTurn(live, "aborted by user"),
		);
		this.complete({ kind: "cancelled" });
	}

	async succeed(): Promise<void> {
		await this.deps.liveState.update(this.request.sessionId, (live) => endTurn(live));
		this.complete({ kind: "success" });
	}

	private complete(outcome: TurnOutcome): void {
		this.resolveSettled(outcome);
		if (this.run !== null) this.deps.onTurnSettled(this.run);
	}
}

class FakeTurns {
	readonly turns: FakeTurn[] = [];
	readonly factory: TurnFactory = (deps, request) => {
		const turn = new FakeTurn(deps, request);
		this.turns.push(turn);
		return turn;
	};

	last(): FakeTurn {
		const turn = this.turns.at(-1);
		if (turn === undefined) throw new Error("No turn was started");
		return turn;
	}
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

async function until(check: () => boolean, description: string): Promise<void> {
	const deadline = Date.now() + 2000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}

interface Harness {
	manager: DefaultSessionManager;
	app: FakeApp;
	liveState: TestLiveState;
	processes: FakeProcesses;
	prompt: FakePrompt;
	publisher: FakePublisher;
	interactions: FakeInteractions;
	checkpoints: FakeCheckpoints;
	turns: FakeTurns;
	logs: string[];
	runners: Map<AgentKind, FakeRunner>;
}

function harness(
	options: {
		runners?: FakeRunner[];
		liveState?: (app: FakeApp) => TestLiveState;
		prompt?: FakePrompt;
		/** Uses the real outbox, publisher, live state and Turn, all on the one shared queue. */
		realPipeline?: boolean;
	} = {},
): Harness {
	const app = new FakeApp();
	const queue = new KeyedSerialQueue();
	let realPublisher: BatchingEventPublisher | null = null;
	const liveState = options.liveState?.(app) ?? new TestLiveState(app);
	let pipelineLiveState: LiveStateStore | null = null;
	const turns = new FakeTurns();
	const processes = new FakeProcesses();
	const prompt = options.prompt ?? new FakePrompt();
	const publisher = new FakePublisher();
	const interactions = new FakeInteractions();
	const checkpoints = new FakeCheckpoints();
	const logs: string[] = [];
	const logger: Logger = createLogger({
		sink: (record) => logs.push(`${record.level}:${record.message}`),
		clock: { now: () => 1000 },
		level: "debug",
		scope: "test",
	});
	if (options.realPipeline === true) {
		const outbox = new FileEventOutbox({
			storage: new InMemoryOutboxStorage(),
			queue,
			clock: { now: () => 1000 },
			logger,
		});
		realPublisher = new BatchingEventPublisher({
			outbox,
			app,
			clock: { now: () => 1000 },
			logger,
			sleep: async () => {},
		});
		const flushing = realPublisher;
		pipelineLiveState = new LiveStateStore({ app, flushed: (id) => flushing.flush(id) });
	}
	const runners = new Map<AgentKind, FakeRunner>();
	const entries: { selector: { agent: AgentKind }; runner: Runner }[] = [];
	for (const runner of options.runners ?? [new FakeRunner("claude"), new FakeRunner("codex")]) {
		runners.set(runner.agent, runner);
		entries.push({ selector: { agent: runner.agent }, runner });
	}
	const registry: RunnerRegistry = {
		get(selector) {
			const runner = runners.get(selector.agent);
			return runner === undefined
				? { ok: false, error: { code: "runner_unknown", message: "missing" } }
				: ok(runner);
		},
		all: () => entries,
	};
	let nextId = 0;
	const deps: SessionManagerDeps = {
		app,
		runners: registry,
		processes,
		checkpoints,
		prompt,
		shellEnv: fakeShellEnv(),
		publisher: realPublisher ?? publisher,
		liveState: pipelineLiveState ?? liveState,
		interactions,
		queue,
		clock: { now: () => 1000 },
		ids: { uuid: () => `event-${++nextId}` },
		logger,
		...(options.realPipeline === true ? {} : { createTurn: turns.factory }),
	};
	return {
		manager: new DefaultSessionManager(deps),
		app,
		liveState,
		processes,
		prompt,
		publisher,
		interactions,
		checkpoints,
		turns,
		logs,
		runners,
	};
}

function fakeShellEnv(): ShellEnvProvider {
	const captured: CapturedShellEnv = {
		shell: "/bin/zsh",
		path: "/usr/bin",
		env: { PATH: "/usr/bin" },
	};
	return {
		get: async () => ok(captured),
		refresh: async () => ok(captured),
	};
}

function sendParams(
	overrides: Partial<Parameters<DefaultSessionManager["sendMessage"]>[0]> = {},
): Parameters<DefaultSessionManager["sendMessage"]>[0] {
	return {
		sessionId: sid("session-1"),
		messageId: mid("message-1"),
		turnId: tid("turn-1"),
		text: "hello",
		attachmentPaths: [],
		delivery: "new_turn",
		firstMessage: true,
		config: baseConfig(),
		workspace: workspace("/work/alpha"),
		launch: launch(),
		...overrides,
	};
}

describe("SIDE-03 duplicate guard and queue", () => {
	test("SIDE-03 two sends with one message id start one turn and repeat the delivery", async () => {
		const h = harness();
		const first = await h.manager.sendMessage(sendParams());
		const second = await h.manager.sendMessage(sendParams());

		expect(first).toEqual(ok({ deliveredAs: "new_turn" }));
		expect(second).toEqual(ok({ deliveredAs: "new_turn" }));
		expect(h.turns.turns).toHaveLength(1);
	});

	test("SIDE-03 a message for a working chat waits in memory and starts at turn end", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());

		const queued = await h.manager.sendMessage(
			sendParams({ messageId: mid("message-2"), turnId: tid("turn-2"), text: "next" }),
		);
		expect(queued).toEqual(ok({ deliveredAs: "queued" }));
		expect(h.turns.turns).toHaveLength(1);

		await h.turns.last().succeed();
		await until(() => h.turns.turns.length === 2, "the queued message to start");

		expect(h.turns.last().request.messageId).toBe(mid("message-2"));
		expect(h.turns.last().request.config).toEqual(baseConfig());
	});

	test("SIDE-03 a repeated queued message id is answered with queued and starts nothing", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const queued = sendParams({
			messageId: mid("message-2"),
			turnId: tid("turn-2"),
			text: "next",
		});
		await h.manager.sendMessage(queued);

		expect(await h.manager.sendMessage(queued)).toEqual(ok({ deliveredAs: "queued" }));
		expect(h.turns.turns).toHaveLength(1);
	});

	test("SIDE-03 the same message id in two chats is not a duplicate", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		await h.manager.sendMessage(
			sendParams({ sessionId: sid("session-2"), workspace: workspace("/work/beta") }),
		);

		expect(h.turns.turns).toHaveLength(2);
	});
});

describe("SIDE-03 delivery while working", () => {
	test("SIDE-03 a steer goes to the runner and stays pending until the agent reads it", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		const consumed = deferred();
		agent.consumed = consumed.promise;

		const steered = await h.manager.sendMessage(
			sendParams({ messageId: mid("message-2"), turnId: tid("turn-2"), delivery: "steer" }),
		);
		expect(steered).toEqual(ok({ deliveredAs: "steer" }));
		expect(agent.steerCalls).toBe(1);
		expect(h.liveState.get(sid("session-1")).pendingSteerIds).toEqual([mid("message-2")]);
		expect(h.publisher.events).toHaveLength(1);
		expect(h.publisher.events[0]?.event).toMatchObject({
			type: "user_message",
			delivery: "steer",
			messageId: mid("message-2"),
		});

		consumed.resolve();
		await until(
			() => h.liveState.get(sid("session-1")).pendingSteerIds.length === 0,
			"the agent to read the steer",
		);
		expect(
			await h.manager.sendMessage(
				sendParams({
					messageId: mid("message-2"),
					turnId: tid("turn-2"),
					delivery: "steer",
				}),
			),
		).toEqual(ok({ deliveredAs: "steer" }));
	});

	test("SIDE-03 a steer retried after its turn ended is still a steer and starts no turn", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		const consumed = deferred();
		agent.consumed = consumed.promise;
		const steer = sendParams({
			messageId: mid("message-2"),
			turnId: tid("turn-2"),
			delivery: "steer",
		});

		expect(await h.manager.sendMessage(steer)).toEqual(ok({ deliveredAs: "steer" }));
		await h.turns.last().succeed();

		expect(await h.manager.sendMessage(steer)).toEqual(ok({ deliveredAs: "steer" }));
		expect(h.turns.turns).toHaveLength(1);
		expect(agent.steerCalls).toBe(1);
	});

	test("SIDE-03 a steer whose pending mark fails is delivered once, not sent again", async () => {
		let failMark = false;
		class FailingMarkLiveState extends TestLiveState {
			override async update(
				sessionId: SessionId,
				reducer: (state: LiveState) => LiveState,
			): Promise<void> {
				if (failMark) throw new Error("the live state could not be written");
				await super.update(sessionId, reducer);
			}
		}
		const h = harness({ liveState: (app) => new FailingMarkLiveState(app) });
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		failMark = true;

		const steered = await h.manager.sendMessage(
			sendParams({ messageId: mid("message-2"), turnId: tid("turn-2"), delivery: "steer" }),
		);

		expect(steered).toEqual(ok({ deliveredAs: "steer" }));
		expect(agent.steerCalls).toBe(1);
		expect(h.turns.turns).toHaveLength(1);
	});

	test("SIDE-03 a steer queues when the runner cannot steer", async () => {
		const h = harness({ runners: [new FakeRunner("claude", { steer: false })] });
		await h.manager.sendMessage(sendParams());

		const steered = await h.manager.sendMessage(
			sendParams({ messageId: mid("message-2"), turnId: tid("turn-2"), delivery: "steer" }),
		);
		expect(steered).toEqual(ok({ deliveredAs: "queued" }));
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		expect(agent.steerCalls).toBe(0);
	});

	test("SIDE-03 a steer the agent hands back becomes a queued message", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		agent.steerError = new SteerRevertedError();

		const steered = await h.manager.sendMessage(
			sendParams({ messageId: mid("message-2"), turnId: tid("turn-2"), delivery: "steer" }),
		);
		expect(steered).toEqual(ok({ deliveredAs: "queued" }));
	});

	test("SIDE-03 an idle chat turns a steer request into a new turn", async () => {
		const h = harness();
		const result = await h.manager.sendMessage(sendParams({ delivery: "steer" }));

		expect(result).toEqual(ok({ deliveredAs: "new_turn" }));
		expect(h.turns.turns).toHaveLength(1);
	});
});

describe("SIDE-03 cancel, reset and status", () => {
	test("SIDE-03 cancel drops queued messages and reports them and wasWorking", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				text: "queued",
			}),
		);

		const cancelled = await h.manager.cancel({ sessionId: sid("session-1") });
		expect(cancelled).toEqual(ok({ wasWorking: true, droppedMessageIds: [mid("message-2")] }));
		expect(h.interactions.withdrawn).toContain(sid("session-1"));
		expect(h.liveState.get(sid("session-1")).status).toBe("idle");

		const again = await h.manager.sendMessage(
			sendParams({ messageId: mid("message-2"), turnId: tid("turn-2"), text: "queued" }),
		);
		expect(again).toEqual(ok({ deliveredAs: "new_turn" }));
	});

	test("SIDE-03 cancel with nothing running still leaves the chat idle", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		await h.turns.last().succeed();
		await until(() => h.liveState.get(sid("session-1")).status === "idle", "idle");

		const cancelled = await h.manager.cancel({ sessionId: sid("session-1") });
		expect(cancelled).toEqual(ok({ wasWorking: false, droppedMessageIds: [] }));
		expect(h.liveState.get(sid("session-1")).status).toBe("idle");
	});

	test("SIDE-03 cancel stops a send that is still setting up", async () => {
		const h = harness();
		const gate = deferred();
		h.prompt.gate = gate.promise;
		const sending = h.manager.sendMessage(sendParams());
		await until(() => h.prompt.inputs.length === 1, "prompt assembly to start");

		const cancelled = await h.manager.cancel({ sessionId: sid("session-1") });
		gate.resolve();

		expect(cancelled).toEqual(ok({ wasWorking: false, droppedMessageIds: [] }));
		const result = await sending;
		expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
		expect(h.turns.turns).toHaveLength(0);
	});

	test("SIDE-03 getSessionStatus answers unknown before a chat and its live state after", async () => {
		const h = harness();
		expect(await h.manager.getSessionStatus({ sessionId: sid("session-1") })).toEqual(
			ok({ known: false }),
		);

		await h.manager.sendMessage(sendParams());
		const status = await h.manager.getSessionStatus({ sessionId: sid("session-1") });
		expect(status).toEqual(ok({ known: true, liveState: h.liveState.get(sid("session-1")) }));
		expect(h.liveState.get(sid("session-1")).status).toBe("working");
	});

	test("SIDE-03 resetAgent forgets the chat and stops its agent", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());

		expect(await h.manager.resetAgent({ sessionId: sid("session-1") })).toEqual(ok({}));
		expect(h.processes.disconnected).toContain("claude:session-1");
		expect(await h.manager.getSessionStatus({ sessionId: sid("session-1") })).toEqual(
			ok({ known: false }),
		);
	});

	test("SIDE-03 reconnect resends an interaction that is still open", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const request = {
			interactionId: "interaction-1",
			sessionId: sid("session-1"),
			interaction: { kind: "question", questions: [] },
		} as unknown as InteractionRequest;
		h.interactions.openRequests.set(sid("session-1"), request);

		h.manager.onAppAttached();
		await until(() => h.app.requests.length === 1, "the interaction to be resent");
		expect(h.app.requests[0]?.method).toBe("requestInteraction");
	});
});

describe("SIDE-03 prompt, settings and warming", () => {
	test("SIDE-03 prompt assembly runs for every message with its first-message flag", async () => {
		const h = harness();
		const withPreferences = workspace("/work/alpha", { userPreferences: "Use tabs." });
		await h.manager.sendMessage(sendParams({ workspace: withPreferences }));
		await h.turns.last().succeed();
		await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				text: "second",
				firstMessage: false,
				workspace: withPreferences,
			}),
		);

		expect(h.prompt.inputs).toHaveLength(2);
		expect(h.prompt.inputs[0]).toMatchObject({
			text: "hello",
			firstMessage: true,
			workspace: withPreferences,
		});
		expect(h.prompt.inputs[1]).toMatchObject({
			text: "second",
			firstMessage: false,
		});
	});

	test("SIDE-03 warmAgent falls back to the default model and logs it", async () => {
		const h = harness({
			runners: [new FakeRunner("claude", {}, [model("sonnet", true), model("haiku")])],
		});
		const params = {
			sessionId: sid("session-1"),
			config: baseConfig({ model: "missing-model" }),
			workspace: workspace("/work/alpha"),
			launch: launch(),
		};

		await h.manager.warmAgent(params);
		await h.manager.warmAgent(params);

		const runner = h.runners.get("claude");
		expect(runner?.started).toHaveLength(1);
		expect(runner?.started[0]?.config.model).toBe("sonnet");
		expect(h.logs.some((line) => line.includes("default model"))).toBe(true);
	});

	test("SIDE-03 updateConfig applies at once when idle and defers while a turn runs", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		const changed = baseConfig({ model: "opus" });

		expect(await h.manager.updateConfig({ sessionId: sid("session-1"), config: changed })).toEqual(
			ok({ applied: "on_next_turn" }),
		);
		expect(agent.appliedConfigs).toHaveLength(0);

		await h.turns.last().succeed();
		expect(await h.manager.updateConfig({ sessionId: sid("session-1"), config: changed })).toEqual(
			ok({ applied: "live" }),
		);
		expect(agent.appliedConfigs).toEqual([changed]);
	});

	test("SIDE-03 a config carried by the next message is applied to the live agent", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		await h.turns.last().succeed();
		const changed = baseConfig({ model: "opus" });

		await h.manager.sendMessage(
			sendParams({ messageId: mid("message-2"), turnId: tid("turn-2"), config: changed }),
		);

		expect(agent.appliedConfigs).toEqual([changed]);
		expect(h.turns.last().request.config).toEqual(changed);
	});

	test("SIDE-03 a config that needs a restart is applied before the next turn", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		h.turns.last().deps.onAgentSessionId("agent-session-1");
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		agent.applyResult = "restart";
		await h.turns.last().succeed();
		const changed = baseConfig({ model: "opus" });

		await h.manager.sendMessage(
			sendParams({ messageId: mid("message-2"), turnId: tid("turn-2"), config: changed }),
		);

		const runner = h.runners.get("claude");
		expect(runner?.started).toHaveLength(2);
		expect(runner?.started[1]?.config).toEqual(changed);
		expect(runner?.started[1]?.resume).toEqual({ agentSessionId: "agent-session-1" });
	});

	test("SIDE-03 a config change that needs a restart keeps the agent session id", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		h.turns.last().deps.onAgentSessionId("agent-session-1");
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		agent.applyResult = "restart";
		await h.turns.last().succeed();

		await h.manager.updateConfig({
			sessionId: sid("session-1"),
			config: baseConfig({ model: "opus" }),
		});
		await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				config: baseConfig({ model: "opus" }),
			}),
		);

		const runner = h.runners.get("claude");
		expect(runner?.started).toHaveLength(2);
		expect(runner?.started[1]?.resume).toEqual({ agentSessionId: "agent-session-1" });
	});

	test("SIDE-03 setAutoApproveEdits reaches the live agent", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;

		await h.manager.setAutoApproveEdits({ sessionId: sid("session-1"), enabled: true });

		expect(agent.autoApprove).toEqual([true]);
	});

	test("SIDE-03 a changed agent kind stops the old agent before the next turn", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		await h.turns.last().succeed();

		expect(
			await h.manager.updateConfig({
				sessionId: sid("session-1"),
				config: baseConfig({ agent: "codex" }),
			}),
		).toEqual(ok({ applied: "live" }));
		expect(h.processes.disconnected).toContain("claude:session-1");
	});

	test("SIDE-20 a config the agent changed reaches the app with its reason", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const onConfigChanged = h.runners.get("claude")?.started[0]?.onConfigChanged;
		expect(onConfigChanged).toBeDefined();
		const entered = baseConfig({ planMode: true });
		const left = baseConfig({ planMode: false });

		onConfigChanged?.(entered, "entered_plan_mode");
		onConfigChanged?.(left, "left_plan_mode");

		expect(h.app.notifications).toContainEqual({
			method: "agentConfigChanged",
			params: {
				sessionId: sid("session-1"),
				config: entered,
				reason: "entered_plan_mode",
			},
		});
		expect(h.app.notifications).toContainEqual({
			method: "agentConfigChanged",
			params: {
				sessionId: sid("session-1"),
				config: left,
				reason: "left_plan_mode",
			},
		});
	});
});

describe("SIDE-03 session map and agent identity", () => {
	test("SIDE-03 one manager serves chats in different folders and with different agents", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		await h.manager.sendMessage(
			sendParams({
				sessionId: sid("session-2"),
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				config: baseConfig({ agent: "codex" }),
				workspace: workspace("/work/beta"),
			}),
		);

		expect(h.runners.get("claude")?.started[0]?.workspace.workspacePath).toBe("/work/alpha");
		expect(h.runners.get("codex")?.started[0]?.workspace.workspacePath).toBe("/work/beta");
		expect(await h.manager.getSessionStatus({ sessionId: sid("session-1") })).toMatchObject({
			ok: true,
			value: { known: true },
		});
		expect(await h.manager.getSessionStatus({ sessionId: sid("session-2") })).toMatchObject({
			ok: true,
			value: { known: true },
		});
	});

	test("SIDE-03 the agent session id is stored and sent to the app once", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const deps = h.turns.last().deps;

		deps.onAgentSessionId("agent-session-1");
		deps.onAgentSessionId("agent-session-1");

		expect(h.app.notifications.filter((entry) => entry.method === "agentSessionId")).toHaveLength(
			1,
		);
	});

	test("SIDE-03 shutdown stops every agent, waits for turns and takes no checkpoint", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		agent.onCancel = () => {
			void h.turns.last().succeed();
		};

		await h.manager.shutdown("signal");

		expect(agent.cancelCalls).toBe(1);
		expect(h.processes.stopAllCalls).toBe(1);
		expect(h.checkpoints.starts).toHaveLength(0);
		expect(h.checkpoints.ends).toHaveLength(0);
		expect(await h.manager.getSessionStatus({ sessionId: sid("session-1") })).toEqual(
			ok({ known: false }),
		);
	});
});

describe("SIDE-03 real pipeline on one shared queue", () => {
	test("SIDE-03 the first message of a chat starts a turn with the real outbox, publisher and Turn", async () => {
		const h = harness({ realPipeline: true });

		const sent = await Promise.race([
			h.manager.sendMessage(sendParams()),
			new Promise<"deadlock">((resolve) => setTimeout(() => resolve("deadlock"), 1500)),
		]);

		expect(sent).toEqual(ok({ deliveredAs: "new_turn" }));
		await h.manager.shutdown("signal");
	});
});
