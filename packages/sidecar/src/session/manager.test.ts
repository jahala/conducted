import { describe, expect, test } from "bun:test";
import type {
	AcpConfigOption,
	InteractionRequest,
	LiveState,
	ModelInfo,
	SessionConfig,
	WorkspaceContext,
} from "@conducted/protocol";
import { idleLiveState } from "@conducted/protocol";
import type {
	AgentKind,
	AppError,
	InteractionId,
	MessageId,
	Result,
	SessionId,
	TurnId,
} from "@conducted/shared";
import { appError, createKeyedQueue, ok } from "@conducted/shared";
import type {
	CheckpointOutcome,
	CheckpointRequest,
	CheckpointService,
} from "../checkpoints/checkpoint-service.ts";
import { createLogger, type Logger } from "../logging/logger.ts";
import { RunnerModelCatalog } from "../models/catalog.ts";
import { FileEventOutbox } from "../outbox/event-outbox.ts";
import { IDLE_STOP_AFTER_MS } from "../process/idle-policy.ts";
import type { PromptAssembler, PromptInput } from "../prompt/assemble.ts";
import type { SidecarToApp } from "../rpc/types.ts";
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
import { FakeApp } from "../test-support/fake-app.ts";
import { FakeInteractions } from "../test-support/fake-interactions.ts";
import { FakeProcesses } from "../test-support/fake-processes.ts";
import { FakePublisher } from "../test-support/fake-publisher.ts";
import { MemoryStorage } from "../test-support/memory-storage.ts";
import { BatchingEventPublisher } from "./event-batcher.ts";
import { beginTurn, endTurn, LiveStateStore } from "./live-state.ts";
import {
	DefaultSessionManager,
	type SessionManagerDeps,
	type SessionTurn,
	type TurnFactory,
} from "./manager.ts";
import type { RunNumber } from "./run-guard.ts";
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
	readonly remoteControl: boolean[] = [];
	listedOptions: AcpConfigOption[] = [];
	readonly setOptionCalls: {
		optionId: string;
		value: string | boolean;
		config: SessionConfig;
	}[] = [];

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

	setRemoteControl(enabled: boolean): void {
		this.remoteControl.push(enabled);
	}

	async listAcpConfigOptions(
		_config: SessionConfig,
		onAgentSessionId?: (agentSessionId: string) => void,
	): Promise<Result<AcpConfigOption[], AppError>> {
		onAgentSessionId?.("acp-session-1");
		return ok(this.listedOptions);
	}

	async setAcpConfigOption(
		optionId: string,
		value: string | boolean,
		config: SessionConfig,
		onAgentSessionId?: (agentSessionId: string) => void,
	): Promise<Result<AcpConfigOption[], AppError>> {
		onAgentSessionId?.("acp-session-1");
		this.setOptionCalls.push({ optionId, value, config });
		this.listedOptions = this.listedOptions.map((option) =>
			option.id !== optionId
				? option
				: {
						...option,
						value:
							option.value.kind === "switch"
								? { kind: "switch", current: value === true }
								: {
										...option.value,
										current: typeof value === "string" ? value : option.value.current,
									},
					},
		);
		return ok(this.listedOptions);
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
		this.listModelsCalls += 1;
		return this.models;
	}

	listModelsCalls = 0;

	async listSlashCommands(
		_workspacePath: string,
	): Promise<{ name: string; description: string }[]> {
		return [];
	}
}

/** A runner whose program is missing: start fails with the error a real runner gives. */
class MissingProgramRunner extends FakeRunner {
	override async start(options: StartOptions): Promise<AgentSession> {
		this.started.push(options);
		throw appError(
			"agent_not_installed",
			"Claude Code was not found. Install it, or choose its program in Settings.",
		);
	}
}

/** An agent whose turn runs until it is cancelled, as a real agent's does. */
class HangingAgentSession extends FakeAgentSession {
	private endTurn: ((outcome: TurnOutcome) => void) | null = null;

	override runTurn(_input: TurnInput, _callbacks: TurnCallbacks): Promise<TurnOutcome> {
		return new Promise<TurnOutcome>((resolve) => {
			this.endTurn = resolve;
		});
	}

	override async cancel(): Promise<void> {
		await super.cancel();
		this.endTurn?.({ kind: "cancelled" });
	}
}

class HangingRunner extends FakeRunner {
	override async start(options: StartOptions): Promise<AgentSession> {
		this.started.push(options);
		return new HangingAgentSession(options.sessionId);
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
	/** The real publisher, when the harness was built with `realPipeline`. */
	pipelinePublisher: BatchingEventPublisher | null;
}

function harness(
	options: {
		runners?: FakeRunner[];
		liveState?: (app: FakeApp) => TestLiveState;
		prompt?: FakePrompt;
		/** Uses the real outbox, publisher, live state and Turn, all on the one shared queue. */
		realPipeline?: boolean;
		/** Provider keys the captured login shell has, for "Use the key from this Mac". */
		macSecrets?: Record<string, string>;
		/** The process manager stand-in, when a test moves its clock. */
		processes?: FakeProcesses;
	} = {},
): Harness {
	const app = new FakeApp();
	const queue = createKeyedQueue();
	let realPublisher: BatchingEventPublisher | null = null;
	const liveState = options.liveState?.(app) ?? new TestLiveState(app);
	let pipelineLiveState: LiveStateStore | null = null;
	const turns = new FakeTurns();
	const processes = options.processes ?? new FakeProcesses();
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
			storage: new MemoryStorage(),
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
		shellEnv: fakeShellEnv(options.macSecrets),
		publisher: realPublisher ?? publisher,
		liveState: pipelineLiveState ?? liveState,
		interactions,
		queue,
		models: new RunnerModelCatalog({
			runners: registry,
			shellEnv: fakeShellEnv(options.macSecrets),
			logger,
			clock: { now: () => 1000 },
		}),
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
		pipelinePublisher: realPublisher,
	};
}

function fakeShellEnv(providerSecrets: Record<string, string> = {}): ShellEnvProvider {
	const captured: CapturedShellEnv = {
		shell: "/bin/zsh",
		path: "/usr/bin",
		env: { PATH: "/usr/bin" },
		providerSecrets,
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

describe("AGENT-17 ACP chat options", () => {
	test("AGENT-17 lists the options an ACP chat's live agent reports", async () => {
		const h = harness({ runners: [new FakeRunner("acp")] });
		const config = baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" });
		await h.manager.sendMessage(sendParams({ config }));
		await h.turns.last().succeed();
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		const options: AcpConfigOption[] = [
			{
				id: "thought_level",
				name: "Thought level",
				value: {
					kind: "select",
					current: "high",
					choices: [{ value: "high", name: "High" }],
				},
			},
		];
		agent.listedOptions = options;

		const listed = await h.manager.listAcpConfigOptions({ sessionId: sid("session-1") });

		expect(listed).toEqual(ok({ options }));
		expect(h.app.notifications).toContainEqual({
			method: "agentSessionId",
			params: { sessionId: sid("session-1"), agentSessionId: "acp-session-1" },
		});
	});

	test("AGENT-17 sets one option and keeps it in the chat's config", async () => {
		const h = harness({ runners: [new FakeRunner("acp")] });
		const config = baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" });
		await h.manager.sendMessage(sendParams({ config }));
		await h.turns.last().succeed();
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		agent.listedOptions = [
			{
				id: "thought_level",
				name: "Thought level",
				value: {
					kind: "select",
					current: "medium",
					choices: [
						{ value: "medium", name: "Medium" },
						{ value: "high", name: "High" },
					],
				},
			},
		];

		const changed = await h.manager.setAcpConfigOption({
			sessionId: sid("session-1"),
			optionId: "thought_level",
			value: "high",
		});
		const second = await h.manager.setAcpConfigOption({
			sessionId: sid("session-1"),
			optionId: "thought_level",
			value: "high",
		});

		expect("ok" in changed && changed.ok).toBe(true);
		expect("ok" in second && second.ok).toBe(true);
		expect(agent.setOptionCalls[0]).toEqual({
			optionId: "thought_level",
			value: "high",
			config: baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" }),
		});
		expect(agent.setOptionCalls[1]?.config.acpConfig).toEqual({ thought_level: "high" });
	});

	test("AGENT-17 refuses an option change while a reply is running", async () => {
		const h = harness({ runners: [new HangingRunner("acp")] });
		const config = baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" });
		await h.manager.sendMessage(sendParams({ config }));

		const changed = await h.manager.setAcpConfigOption({
			sessionId: sid("session-1"),
			optionId: "thought_level",
			value: "high",
		});

		expect("ok" in changed && !changed.ok).toBe(true);
		if ("ok" in changed && !changed.ok) expect(changed.error.code).toBe("acp_options_busy");
		await h.manager.cancel({ sessionId: sid("session-1") });
	});
});

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
		expect(status).toEqual(
			ok({
				known: true,
				liveState: h.liveState.get(sid("session-1")),
				remoteControl: { state: "off" },
			}),
		);
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
			interactionId: "interaction-1" as InteractionId,
			sessionId: sid("session-1"),
			interaction: {
				kind: "question",
				questions: [{ question: "Which one?", options: [], multiSelect: false }],
			},
		} satisfies InteractionRequest;
		h.interactions.openRequests.set(sid("session-1"), request);

		h.manager.onAppAttached();
		await until(() => h.app.requests.length === 1, "the interaction to be resent");
		expect(h.app.requests[0]?.method).toBe("requestInteraction");
	});
});

describe("AGENT-15 work the agent starts by itself", () => {
	test("AGENT-15 a report while a turn of ours starts leaves that turn current and stores nothing", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const turn = h.turns.last();
		const run = turn.run;
		if (run === null) throw new Error("The turn did not start");
		const callbacks = h.runners.get("claude")?.started[0]?.selfStartedTurns;
		if (callbacks === undefined) throw new Error("The agent got no callbacks for its own work");
		// The window before the turn's working mark lands: the chat still reads idle.
		h.liveState.set(sid("session-1"), idleLiveState);

		callbacks.onInProgressChanged(true);
		callbacks.onMessage({ agent: "claude", items: [{ kind: "text", text: "on my own" }] });

		// Both calls act at once: a run taken over the turn, or a stored message, would show here.
		expect(turn.deps.runGuard.isCurrent(run)).toBe(true);
		expect(h.publisher.events.filter((entry) => entry.event.type === "agent")).toEqual([]);
	});
});

describe("RC-02 a Claude chat's Remote Control link", () => {
	const sessionUrl = "https://claude.ai/code/session_1";

	test("RC-02 the link the agent reports reaches the app, the chat's status and the process manager", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams({ config: baseConfig({ remoteControl: true }) }));
		const callbacks = h.runners.get("claude")?.started[0]?.remoteControl;
		if (callbacks === undefined) throw new Error("The agent got no Remote Control callbacks");

		callbacks.onStatus({ state: "connected", sessionUrl });
		expect(h.app.notifications).toContainEqual({
			method: "remoteControlState",
			params: { sessionId: sid("session-1"), status: { state: "connected", sessionUrl } },
		});
		expect(await h.manager.getSessionStatus({ sessionId: sid("session-1") })).toMatchObject(
			ok({ known: true, remoteControl: { state: "connected", sessionUrl } }),
		);
		expect(h.processes.remoteControlCalls.at(-1)).toEqual({ key: "claude:session-1", on: true });

		callbacks.onStatus({ state: "off" });
		expect(h.processes.remoteControlCalls.at(-1)).toEqual({ key: "claude:session-1", on: false });
		expect(await h.manager.getSessionStatus({ sessionId: sid("session-1") })).toMatchObject(
			ok({ known: true, remoteControl: { state: "off" } }),
		);
	});

	test("RC-02 a chat the sidecar never started reports Remote Control off", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		expect(await h.manager.getSessionStatus({ sessionId: sid("session-1") })).toMatchObject(
			ok({ known: true, remoteControl: { state: "off" } }),
		);
	});

	test("RC-02 the switch changed during a turn reaches the live agent at once", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.get("claude:session-1") as FakeAgentSession | undefined;
		if (agent === undefined) throw new Error("No agent started");

		const answer = await h.manager.updateConfig({
			sessionId: sid("session-1"),
			config: baseConfig({ remoteControl: true, model: "opus" }),
		});
		expect(answer).toEqual(ok({ applied: "on_next_turn" }));
		expect(agent.remoteControl).toEqual([true]);
		// Only the switch applied now; the model waits for the next turn.
		expect(agent.appliedConfigs.some((config) => config.model === "opus")).toBe(false);

		await h.manager.updateConfig({
			sessionId: sid("session-1"),
			config: baseConfig({ remoteControl: true, model: "opus" }),
		});
		expect(agent.remoteControl).toEqual([true]);
	});
});

describe("RC-03 input from claude.ai reaches the session manager", () => {
	async function idleChat(h: Harness): Promise<NonNullable<StartOptions["remoteControl"]>> {
		await h.manager.sendMessage(sendParams({ config: baseConfig({ remoteControl: true }) }));
		await h.turns.last().succeed();
		await until(() => h.liveState.get(sid("session-1")).status === "idle", "the turn to end");
		const callbacks = h.runners.get("claude")?.started[0]?.remoteControl;
		if (callbacks === undefined) throw new Error("The agent got no Remote Control callbacks");
		return callbacks;
	}

	const userMessages = (h: Harness) =>
		h.publisher.events.filter((entry) => entry.event.type === "user_message");

	test("RC-03 a message typed on claude.ai is stored in the work it started, with its sender", async () => {
		const h = harness();
		const remote = await idleChat(h);
		const self = h.runners.get("claude")?.started[0]?.selfStartedTurns;
		if (self === undefined) throw new Error("The agent got no callbacks for its own work");

		self.onInProgressChanged(true);
		self.onMessage({ agent: "claude", items: [{ kind: "text", text: "On it" }] });
		remote.onUserMessage({ uuid: "remote-1", text: Promise.resolve("From the phone") });
		// The fake turn of the first message stores no events, so this is the only user message.
		await until(() => userMessages(h).length === 1, "the message from claude.ai to be stored");

		const agentEvent = h.publisher.events.find((entry) => entry.event.type === "agent");
		const stored = userMessages(h)[0]?.event;
		expect(stored).toMatchObject({
			type: "user_message",
			messageId: mid("remote-1"),
			text: "From the phone",
			attachmentPaths: [],
			delivery: "new_turn",
			sender: { kind: "claude_ai" },
		});
		expect(stored?.turnId).toBe(agentEvent?.event.turnId as TurnId);
	});

	test("RC-03 a message from claude.ai during the app's turn is stored as a steer of that turn", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams({ config: baseConfig({ remoteControl: true }) }));
		const remote = h.runners.get("claude")?.started[0]?.remoteControl;
		if (remote === undefined) throw new Error("The agent got no Remote Control callbacks");

		remote.onUserMessage({ uuid: "remote-2", text: Promise.resolve("Also add tests") });
		await until(() => userMessages(h).length === 1, "the steer from claude.ai to be stored");

		expect(userMessages(h)[0]?.event).toMatchObject({
			type: "user_message",
			messageId: mid("remote-2"),
			turnId: tid("turn-1"),
			text: "Also add tests",
			delivery: "steer",
			sender: { kind: "claude_ai" },
		});
	});

	test("RC-03 a message whose text never reached the transcript leaves a notice instead", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams({ config: baseConfig({ remoteControl: true }) }));
		const remote = h.runners.get("claude")?.started[0]?.remoteControl;
		if (remote === undefined) throw new Error("The agent got no Remote Control callbacks");

		remote.onUserMessage({ uuid: "remote-3", text: Promise.resolve(null) });
		await until(
			() => h.publisher.events.some((entry) => entry.event.type === "agent"),
			"the notice to be stored",
		);
		expect(userMessages(h)).toEqual([]);
		expect(h.publisher.events.at(-1)?.event).toMatchObject({
			type: "agent",
			turnId: tid("turn-1"),
			message: {
				agent: "claude",
				items: [
					{
						kind: "notice",
						notice: "info",
						text: "A message sent via Claude could not be read from Claude's transcript.",
					},
				],
			},
		});
	});

	test("RC-03 an approval asked during work the agent started opens in the app", async () => {
		const h = harness();
		await idleChat(h);
		const self = h.runners.get("claude")?.started[0]?.selfStartedTurns;
		if (self === undefined) throw new Error("The agent got no callbacks for its own work");

		void self.requestInteraction({
			kind: "tool_approval",
			toolUseId: "tool-1" as never,
			toolName: "Write",
			input: {},
		});
		expect(h.interactions.opened.map((entry) => entry.interaction.kind)).toEqual(["tool_approval"]);
	});
});

describe("CHAT-12 plan feedback is kept in the chat", () => {
	const planAnswer = (approved: boolean, feedback?: string) => ({
		sessionId: sid("session-1"),
		interactionId: "plan-1" as InteractionId,
		answer: {
			kind: "plan_approval" as const,
			approved,
			...(feedback === undefined ? {} : { feedback }),
		},
	});
	const feedbackEvents = (h: Harness) =>
		h.publisher.events.filter(
			(entry) => entry.event.type === "user_message" && entry.event.delivery === "plan_feedback",
		);

	test("CHAT-12 a plan rejected with feedback stores the feedback as a user message", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());

		expect(
			await h.manager.answerInteraction(planAnswer(false, "  Keep the old schema.  ")),
		).toEqual(ok({ accepted: true, superseded: false }));

		const stored = feedbackEvents(h);
		expect(stored).toHaveLength(1);
		expect(stored[0]?.sessionId).toBe(sid("session-1"));
		expect(stored[0]?.event).toMatchObject({
			type: "user_message",
			turnId: tid("turn-1"),
			text: "Keep the old schema.",
			attachmentPaths: [],
			delivery: "plan_feedback",
		});
	});

	test("CHAT-12 an approval, a bare denial and a refused answer store no feedback", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());

		await h.manager.answerInteraction(planAnswer(true));
		await h.manager.answerInteraction(planAnswer(false));
		h.interactions.answerResult = { accepted: false, superseded: true };
		await h.manager.answerInteraction(planAnswer(false, "Too late."));

		expect(feedbackEvents(h)).toEqual([]);
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

		onConfigChanged?.(left, "left_plan_mode");
		onConfigChanged?.(entered, "entered_plan_mode");

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

		// The next message carries the config the app stored from the notification, so the live
		// agent and the new turn run in the mode the agent chose.
		await h.turns.last().succeed();
		const agent = h.processes.agents.values().next().value as FakeAgentSession;
		await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				config: entered,
			}),
		);
		expect(agent.appliedConfigs.at(-1)).toEqual(entered);
		expect(h.turns.last().request.config.planMode).toBe(true);
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
	test("SIDE-03 shutdown cancels the agent and a running real turn takes no end checkpoint and writes no turn_ended", async () => {
		const h = harness({ realPipeline: true, runners: [new HangingRunner("claude")] });
		await h.manager.sendMessage(sendParams());
		expect(h.checkpoints.starts).toHaveLength(1);
		const agent = h.processes.agents.values().next().value as FakeAgentSession;

		await h.manager.shutdown("signal");

		expect(agent.cancelCalls).toBe(1);
		expect(h.checkpoints.ends).toHaveLength(0);
		await h.pipelinePublisher?.flush(sid("session-1"));
		const sent = h.app.notified("sessionEvent").map((envelope) => envelope.event);
		expect(sent.map((event) => event.type)).toEqual(["user_message", "checkpoint"]);
		expect(sent.some((event) => event.type === "turn_ended")).toBe(false);
	});

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

describe("SIDE-21 a changed launch restarts the agent only when the chat is free", () => {
	const withVariable = (value: string) => ({ env: { SETTING: value }, providerKeys: {} });
	const warmParams = (launchValue: ReturnType<typeof withVariable>) => ({
		sessionId: sid("session-1"),
		config: baseConfig(),
		workspace: workspace("/work/alpha"),
		launch: launchValue,
	});

	test("SIDE-21 a change while a turn runs restarts nothing; the next idle message restarts with resume", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams({ launch: withVariable("one") }));
		const runner = h.runners.get("claude") as FakeRunner;
		const first = h.processes.agents.values().next().value as FakeAgentSession;

		await h.manager.warmAgent(warmParams(withVariable("two")));
		expect(runner.started).toHaveLength(1);
		expect(first.disposeCalls).toBe(0);

		await h.turns.last().succeed();
		await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				firstMessage: false,
				launch: withVariable("two"),
				resume: { agentSessionId: "agent-1" },
			}),
		);

		expect(first.disposeCalls).toBe(1);
		expect(runner.started).toHaveLength(2);
		expect(runner.started[1]?.env.SETTING).toBe("two");
		expect(runner.started[1]?.resume).toEqual({ agentSessionId: "agent-1" });
	});

	test("SIDE-21 background tasks keep the agent; the first request after they end restarts it", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams({ launch: withVariable("one") }));
		await h.turns.last().succeed();
		const runner = h.runners.get("claude") as FakeRunner;
		h.liveState.set(sid("session-1"), {
			...h.liveState.get(sid("session-1")),
			backgroundTasks: [{ id: "task-1", kind: "shell", description: "npm run dev" }],
		});

		await h.manager.warmAgent(warmParams(withVariable("two")));
		expect(runner.started).toHaveLength(1);

		h.liveState.set(sid("session-1"), {
			...h.liveState.get(sid("session-1")),
			backgroundTasks: [],
		});
		await h.manager.warmAgent(warmParams(withVariable("two")));

		expect(runner.started).toHaveLength(2);
		expect(runner.started[1]?.env.SETTING).toBe("two");
	});

	test("SIDE-21 a launch changed and changed back while the chat worked restarts nothing", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams({ launch: withVariable("one") }));
		const runner = h.runners.get("claude") as FakeRunner;

		await h.manager.warmAgent(warmParams(withVariable("two")));
		await h.turns.last().succeed();
		await h.manager.warmAgent(warmParams(withVariable("one")));

		expect(runner.started).toHaveLength(1);
		expect(h.processes.disconnected).toEqual([]);
	});

	test("SIDE-21 the program path of the chat's launch reaches the runner's start", async () => {
		const h = harness();

		await h.manager.sendMessage(
			sendParams({ launch: { env: {}, providerKeys: {}, executablePath: "/opt/claude/claude" } }),
		);

		const runner = h.runners.get("claude") as FakeRunner;
		expect(runner.started[0]?.executablePath).toBe("/opt/claude/claude");
	});

	test("SIDE-21 an ACP chat's environment holds only the keys of its own providers", async () => {
		const h = harness({ runners: [new FakeRunner("acp")] });

		await h.manager.sendMessage(
			sendParams({
				config: baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" }),
				launch: {
					env: {},
					providerKeys: {
						OPENROUTER_API_KEY: { value: "or-secret", source: "entered" },
						CURSOR_API_KEY: { value: "cursor-secret", source: "entered" },
					},
				},
			}),
		);

		const runner = h.runners.get("acp") as FakeRunner;
		expect(runner.started[0]?.env.OPENROUTER_API_KEY).toBe("or-secret");
		expect(runner.started[0]?.env.CURSOR_API_KEY).toBeUndefined();
	});

	test("SET-09 a key chosen from this Mac reaches the agent from the captured login shell", async () => {
		const h = harness({ macSecrets: { ANTHROPIC_API_KEY: "sk-from-the-mac" } });

		await h.manager.sendMessage(
			sendParams({
				launch: {
					env: {},
					providerKeys: { ANTHROPIC_API_KEY: { value: "", source: "this_mac" } },
				},
			}),
		);

		const runner = h.runners.get("claude") as FakeRunner;
		expect(runner.started[0]?.env.ANTHROPIC_API_KEY).toBe("sk-from-the-mac");
	});
});

describe("SIDE-03 a turn that cannot start", () => {
	test("SIDE-03 a send whose agent cannot start answers with that start's own error", async () => {
		const h = harness({ runners: [new MissingProgramRunner("claude")] });

		const result = await h.manager.sendMessage(sendParams());

		expect(result).toMatchObject({
			ok: false,
			error: {
				code: "agent_not_installed",
				message: "Claude Code was not found. Install it, or choose its program in Settings.",
			},
		});
		expect(h.turns.turns).toHaveLength(0);
	});

	test("SIDE-03 a queued message whose turn cannot start is stored with the reason", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const queued = await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				text: "next",
				firstMessage: false,
				launch: {
					env: {},
					providerKeys: { ANTHROPIC_API_KEY: { value: "", source: "this_mac" } },
				},
			}),
		);
		expect(queued).toEqual(ok({ deliveredAs: "queued" }));

		await h.turns.last().succeed();
		await until(
			() => h.publisher.events.some(({ event }) => event.type === "turn_ended"),
			"the queued message's turn to end",
		);

		const stored = h.publisher.events
			.map(({ event }) => event)
			.filter((event) => event.turnId === tid("turn-2"));
		expect(stored.map((event) => event.type)).toEqual(["user_message", "turn_ended"]);
		expect(stored[0]).toMatchObject({ messageId: mid("message-2"), text: "next" });
		expect(stored[1]).toMatchObject({ outcome: "error" });
		const ended = stored[1];
		expect(ended?.type === "turn_ended" ? ended.error : undefined).toContain("ANTHROPIC_API_KEY");
		expect(h.turns.turns).toHaveLength(1);
	});
});

describe("SIDE-07 and SIDE-14 the agents the manager keeps", () => {
	test("SIDE-07 an ACP chat whose agent the idle stop ended starts a new one for its options", async () => {
		let now = 0;
		const processes = new FakeProcesses({ now: () => now });
		const h = harness({ runners: [new FakeRunner("acp")], processes });
		const config = baseConfig({ agent: "acp", acpAgent: "opencode", model: "one" });
		await h.manager.sendMessage(sendParams({ config }));
		await h.turns.last().succeed();
		await until(() => processes.idle.length > 0, "the process to go idle");
		now = IDLE_STOP_AFTER_MS + 1;
		await processes.sweep();
		expect(processes.agents.size).toBe(0);

		const listed = await h.manager.listAcpConfigOptions({ sessionId: sid("session-1") });

		expect(listed).toEqual(ok({ options: [] }));
		const runner = h.runners.get("acp") as FakeRunner;
		expect(runner.started).toHaveLength(2);
		expect(processes.agents.size).toBe(1);
	});

	test("SIDE-14 warming a chat twice reads the agent's model list once, through the catalog", async () => {
		const h = harness();
		const params = {
			sessionId: sid("session-1"),
			config: baseConfig(),
			workspace: workspace("/work/alpha"),
			launch: launch(),
		};

		await h.manager.warmAgent(params);
		await h.manager.warmAgent(params);

		const runner = h.runners.get("claude") as FakeRunner;
		expect(runner.listModelsCalls).toBe(1);
	});
});

describe("AGENT-14 Codex compact", () => {
	test("AGENT-14 compact starts a /compact turn for a Codex chat", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams({ config: baseConfig({ agent: "codex" }) }));
		await h.turns.last().succeed();

		const result = await h.manager.compact({ sessionId: sid("session-1") });

		expect(result).toEqual(ok({ started: true }));
		expect(h.turns.turns).toHaveLength(2);
		const request = h.turns.last().request;
		expect(request.text).toBe("/compact");
		expect(request.agentText).toBe("/compact");
		expect(request.config.agent).toBe("codex");
	});

	test("AGENT-14 compact answers started false while a turn runs", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams({ config: baseConfig({ agent: "codex" }) }));

		const result = await h.manager.compact({ sessionId: sid("session-1") });

		expect(result).toEqual(ok({ started: false }));
		expect(h.turns.turns).toHaveLength(1);
	});

	test("AGENT-14 a typed /compact while a Codex turn runs is queued, never steered", async () => {
		const h = harness();
		const codex = baseConfig({ agent: "codex" });
		await h.manager.sendMessage(sendParams({ config: codex }));
		const agent = h.processes.agents.values().next().value as FakeAgentSession;

		const sent = await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				text: "/compact",
				delivery: "steer",
				config: codex,
			}),
		);

		expect(sent).toEqual(ok({ deliveredAs: "queued" }));
		expect(agent.steerCalls).toBe(0);
		await h.turns.last().succeed();
		await until(() => h.turns.turns.length === 2, "the queued compact to start");
		expect(h.turns.last().request.text).toBe("/compact");
	});

	test("AGENT-14 a typed /compact steered into a Claude turn is an ordinary steer", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;

		const sent = await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				text: "/compact",
				delivery: "steer",
			}),
		);

		expect(sent).toEqual(ok({ deliveredAs: "steer" }));
		expect(agent.steerCalls).toBe(1);
	});

	test("AGENT-14 compact refuses an unknown chat and another agent", async () => {
		const h = harness();

		const unknown = await h.manager.compact({ sessionId: sid("missing") });
		expect(unknown).toMatchObject({ ok: false, error: { code: "session_unknown" } });

		await h.manager.sendMessage(sendParams());
		await h.turns.last().succeed();
		const claude = await h.manager.compact({ sessionId: sid("session-1") });
		expect(claude).toMatchObject({ ok: false, error: { code: "compact_unsupported" } });
		expect(h.turns.turns).toHaveLength(1);
	});
});

describe("AGENT-13 /goal messages", () => {
	test("AGENT-13 /goal alone to an idle Codex chat answers a usage error and starts no turn", async () => {
		const h = harness();

		const sent = await h.manager.sendMessage(
			sendParams({ text: "/goal", config: baseConfig({ agent: "codex" }) }),
		);

		expect(sent).toMatchObject({ ok: false, error: { code: "goal_usage" } });
		expect(h.turns.turns).toHaveLength(0);
	});

	test("AGENT-13 /goal alone steered into a Claude turn is an ordinary steer", async () => {
		const h = harness();
		await h.manager.sendMessage(sendParams());
		const agent = h.processes.agents.values().next().value as FakeAgentSession;

		const sent = await h.manager.sendMessage(
			sendParams({
				messageId: mid("message-2"),
				turnId: tid("turn-2"),
				text: "/goal",
				delivery: "steer",
			}),
		);

		expect(sent).toEqual(ok({ deliveredAs: "steer" }));
		expect(agent.steerCalls).toBe(1);
	});
});
