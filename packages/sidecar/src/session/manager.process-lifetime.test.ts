/**
 * @feature SIDE-07 Process manager: leases, idle stop, warm pool
 * Owns: the tests that the session manager, the real turn and the real AgentProcessManager agree on
 * when a chat's agent process is idle: after a turn ends (also after a cancel), the process is
 * stopped once it has been idle for IDLE_STOP_AFTER_MS, and never while a turn runs or a
 * background task is open.
 * Test first: "a chat that ran an ordinary turn is stopped after the idle limit" (review finding
 * H-3: nothing called markIdle, so the process lived until the sidecar exited).
 */
import { describe, expect, test } from "bun:test";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import {
	type AppError,
	type Clock,
	createKeyedQueue,
	type MessageId,
	ok,
	type Result,
	type SessionId,
	type TurnId,
} from "@conducted/shared";
import type {
	CheckpointOutcome,
	CheckpointRequest,
	CheckpointService,
} from "../checkpoints/checkpoint-service.ts";
import { createLogger } from "../logging/logger.ts";
import { RunnerModelCatalog } from "../models/catalog.ts";
import { IDLE_STOP_AFTER_MS } from "../process/idle-policy.ts";
import { AgentProcessManager } from "../process/process-manager.ts";
import type { PromptAssembler, PromptInput } from "../prompt/assemble.ts";
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
import { FakeApp } from "../test-support/fake-app.ts";
import { FakeInteractions } from "../test-support/fake-interactions.ts";
import { FakePublisher } from "../test-support/fake-publisher.ts";
import { loginShellOver } from "../test-support/login-shell.ts";
import { until } from "../test-support/until.ts";
import { LiveStateStore } from "./live-state.ts";
import { DefaultSessionManager } from "./manager.ts";

const sessionId = "session-1" as SessionId;

class TestClock implements Clock {
	nowMs = 1_000;
	now(): number {
		return this.nowMs;
	}
	advance(ms: number): void {
		this.nowMs += ms;
	}
}

/** An agent whose turn lasts until the test finishes it. Cancel ends the turn as cancelled. */
class GatedAgent implements AgentSession {
	readonly sessionId = sessionId;
	disposeCalls = 0;
	callbacks: TurnCallbacks | null = null;
	turns = 0;
	private finishTurn: ((outcome: TurnOutcome) => void) | null = null;

	runTurn(_input: TurnInput, callbacks: TurnCallbacks): Promise<TurnOutcome> {
		this.turns += 1;
		this.callbacks = callbacks;
		return new Promise<TurnOutcome>((resolve) => {
			this.finishTurn = resolve;
		});
	}

	finish(outcome: TurnOutcome = { kind: "success" }): void {
		this.finishTurn?.(outcome);
	}

	async steer(): Promise<{ consumed: Promise<void> }> {
		return { consumed: Promise.resolve() };
	}

	async cancel(): Promise<void> {
		this.finishTurn?.({ kind: "cancelled" });
	}

	async applyConfig(): Promise<"applied"> {
		return "applied";
	}

	async contextUsage(): Promise<null> {
		return null;
	}

	async dispose(): Promise<void> {
		this.disposeCalls += 1;
	}
}

class OneAgentRunner implements Runner {
	readonly agent = "claude" as const;
	readonly capabilities: RunnerCapabilities = {
		steer: true,
		interrupt: true,
		resumeAt: true,
		liveConfig: true,
		slashCommands: true,
		mcpServers: true,
		contextUsage: true,
	};
	readonly agentSession = new GatedAgent();
	starts = 0;

	async detect(): Promise<null> {
		return null;
	}

	async start(_options: StartOptions): Promise<AgentSession> {
		this.starts += 1;
		return this.agentSession;
	}

	async listModels() {
		return [];
	}

	async listSlashCommands() {
		return [];
	}
}

class NoCheckpoints implements CheckpointService {
	async start(_request: CheckpointRequest): Promise<CheckpointOutcome> {
		return {};
	}

	async end(_request: CheckpointRequest): Promise<CheckpointOutcome> {
		return {};
	}
}

class EchoPrompt implements PromptAssembler {
	async assemble(input: PromptInput): Promise<Result<string, AppError>> {
		return ok(input.text);
	}
}

function config(): SessionConfig {
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

function workspace(): WorkspaceContext {
	return {
		workspaceId: "workspace-1" as WorkspaceContext["workspaceId"],
		workspaceName: "alpha",
		workspacePath: "/work/alpha",
		repoRootPath: "/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		host: { kind: "local" },
		port: 4100,
	};
}

function harness() {
	const clock = new TestClock();
	const logger = createLogger({ sink: () => {}, clock, level: "error", scope: "test" });
	const app = new FakeApp();
	const runner = new OneAgentRunner();
	const registry: RunnerRegistry = {
		get: () => ok(runner),
		all: () => [{ selector: { agent: "claude" }, runner }],
	};
	const processes = new AgentProcessManager({ clock, logger });
	const publisher = new FakePublisher();
	const liveState = new LiveStateStore({ app, flushed: async () => {} });
	let nextId = 0;
	const manager = new DefaultSessionManager({
		app,
		runners: registry,
		processes,
		checkpoints: new NoCheckpoints(),
		prompt: new EchoPrompt(),
		shellEnv: {
			get: async () =>
				ok({ shell: "/bin/zsh", path: "/usr/bin", env: { PATH: "/usr/bin" }, providerSecrets: {} }),
			refresh: async () =>
				ok({ shell: "/bin/zsh", path: "/usr/bin", env: { PATH: "/usr/bin" }, providerSecrets: {} }),
		},
		publisher,
		liveState,
		interactions: new FakeInteractions(),
		queue: createKeyedQueue(),
		models: new RunnerModelCatalog({
			runners: registry,
			shellEnv: loginShellOver({ PATH: "/usr/bin" }, logger),
			logger,
			clock,
		}),
		clock,
		ids: { uuid: () => `id-${++nextId}` },
		logger,
	});
	return { clock, runner, agent: runner.agentSession, processes, manager, liveState, publisher };
}

type Harness = ReturnType<typeof harness>;

function send(h: Harness, n: number) {
	return h.manager.sendMessage({
		sessionId,
		messageId: `message-${n}` as MessageId,
		turnId: `turn-${n}` as TurnId,
		text: `hello ${n}`,
		attachmentPaths: [],
		delivery: "new_turn",
		firstMessage: n === 1,
		config: config(),
		workspace: workspace(),
		launch: { env: {}, providerKeys: {} },
	});
}

/** Waits until the chat is idle and the manager has handled the end of the turn. */
async function untilTurnHandled(h: Harness): Promise<void> {
	await until(() => h.liveState.get(sessionId).status === "idle", "the chat to be idle");
	// The manager handles the end of a turn on the chat's queue, a few promise steps later.
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("SIDE-07 the agent process of a chat that ran turns", () => {
	test("a chat that ran an ordinary turn is stopped after the idle limit", async () => {
		const h = harness();
		await send(h, 1);
		h.agent.finish();
		await untilTurnHandled(h);

		h.clock.advance(IDLE_STOP_AFTER_MS - 1);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(0);

		h.clock.advance(1);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(1);
	});

	test("a chat whose turn is still running is never stopped", async () => {
		const h = harness();
		await send(h, 1);

		h.clock.advance(IDLE_STOP_AFTER_MS * 2);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(0);

		h.agent.finish();
		await untilTurnHandled(h);
		h.clock.advance(IDLE_STOP_AFTER_MS);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(1);
	});

	test("a cancelled turn leaves the process idle", async () => {
		const h = harness();
		await send(h, 1);

		await h.manager.cancel({ sessionId });

		h.clock.advance(IDLE_STOP_AFTER_MS);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(1);
	});

	test("a failed turn leaves the process idle", async () => {
		const h = harness();
		await send(h, 1);
		h.agent.finish({ kind: "error", message: "The agent crashed.", retryable: false });
		await untilTurnHandled(h);

		h.clock.advance(IDLE_STOP_AFTER_MS);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(1);
	});

	test("a queued message keeps the process busy through its own turn, and the idle clock starts at its end", async () => {
		const h = harness();
		await send(h, 1);
		expect(await send(h, 2)).toEqual(ok({ deliveredAs: "queued" }));
		h.agent.finish();
		await until(() => h.agent.turns === 2, "the queued message to start its turn");
		// The lease of the second turn is given back a few promise steps after its turn started.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		h.clock.advance(IDLE_STOP_AFTER_MS * 2);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(0);

		h.agent.finish();
		await untilTurnHandled(h);
		h.clock.advance(IDLE_STOP_AFTER_MS);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(1);
		expect(h.runner.starts).toBe(1);
	});

	test("a process with a background task survives the idle limit until the task ends", async () => {
		const h = harness();
		await send(h, 1);
		h.agent.callbacks?.onBackgroundTasks([{ id: "task-1", kind: "shell", description: "tests" }]);
		h.agent.finish();
		await untilTurnHandled(h);

		h.clock.advance(IDLE_STOP_AFTER_MS * 2);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(0);

		h.agent.callbacks?.onBackgroundTasks([]);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(1);
	});

	test("a new message after the process was stopped starts a new process", async () => {
		const h = harness();
		await send(h, 1);
		h.agent.finish();
		await untilTurnHandled(h);
		h.clock.advance(IDLE_STOP_AFTER_MS);
		await h.processes.sweep();
		expect(h.agent.disposeCalls).toBe(1);

		await send(h, 2);

		expect(h.runner.starts).toBe(2);
		h.agent.finish();
		await untilTurnHandled(h);
	});
});
