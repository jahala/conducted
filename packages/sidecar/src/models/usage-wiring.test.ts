import { describe, expect, test } from "bun:test";
import type {
	AgentInstall,
	ModelInfo,
	RateLimit,
	SessionConfig,
	SessionEventEnvelope,
	WorkspaceContext,
} from "@conducted/protocol";
import {
	type AppError,
	appError,
	createKeyedQueue,
	type EventId,
	err,
	type MessageId,
	ok,
	type Result,
	type SessionId,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import type {
	CheckpointOutcome,
	CheckpointRequest,
	CheckpointService,
} from "../checkpoints/checkpoint-service.ts";
import { createLogger, type Logger } from "../logging/logger.ts";
import type { AgentDetector } from "../models/agent-detection.ts";
import { type ModelCatalog, RunnerModelCatalog } from "../models/catalog.ts";
import type { McpServerLister, SlashCommandLister } from "../models/slash-and-mcp.ts";
import type { EventOutbox } from "../outbox/event-outbox.ts";
import type { PromptAssembler, PromptInput } from "../prompt/assemble.ts";
import { buildHandlers, type HandlerDeps } from "../rpc/handlers.ts";
import type {
	AgentSession,
	Runner,
	RunnerCapabilities,
	RunnerSlashCommand,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runners/runner.ts";
import { LiveStateStore } from "../session/live-state.ts";
import {
	DefaultSessionManager,
	type SessionManagerDeps,
	type SessionTurn,
} from "../session/manager.ts";
import type { RunNumber } from "../session/run-guard.ts";
import type { UtilityPromptRunner } from "../session/utility-prompt.ts";
import type { CapturedShellEnv, ShellEnvProvider } from "../shell-env/capture.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import { FakeInteractions } from "../test-support/fake-interactions.ts";
import { FakeProcesses } from "../test-support/fake-processes.ts";
import { FakePublisher } from "../test-support/fake-publisher.ts";
import { SessionUsageReader } from "./usage.ts";

const sessionId = "session-1" as SessionId;

class FakeAgentSession implements AgentSession {
	readonly sessionId = sessionId;

	constructor(private readonly limits: RateLimit[]) {}

	async runTurn(_input: TurnInput, _callbacks: TurnCallbacks): Promise<TurnOutcome> {
		return { kind: "success" };
	}

	async steer(_input: TurnInput): Promise<{ consumed: Promise<void> }> {
		return { consumed: Promise.resolve() };
	}

	async cancel(): Promise<void> {}

	async applyConfig(_config: SessionConfig): Promise<"applied" | "restart"> {
		return "applied";
	}

	async contextUsage(): Promise<{ usedTokens: number; windowTokens: number } | null> {
		return { usedTokens: 11, windowTokens: 100 };
	}

	async planUsage(): Promise<RateLimit[]> {
		return this.limits;
	}

	async dispose(): Promise<void> {}
}

class FakeRunner implements Runner {
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

	constructor(private readonly session: AgentSession) {}

	async detect(_env: Readonly<Record<string, string>>): Promise<null> {
		return null;
	}

	async start(_options: StartOptions): Promise<AgentSession> {
		return this.session;
	}

	async listModels(): Promise<ModelInfo[]> {
		return [];
	}

	async listSlashCommands(_workspacePath: string): Promise<RunnerSlashCommand[]> {
		return [];
	}
}

class FakeCheckpoints implements CheckpointService {
	async start(_request: CheckpointRequest): Promise<CheckpointOutcome> {
		return {};
	}

	async end(_request: CheckpointRequest): Promise<CheckpointOutcome> {
		return {};
	}
}

class FakePrompt implements PromptAssembler {
	async assemble(input: PromptInput): Promise<Result<string, AppError>> {
		return ok(`agent:${input.text}`);
	}
}

function fakeShellEnv(): ShellEnvProvider {
	const captured: CapturedShellEnv = {
		shell: "/bin/zsh",
		path: "/usr/bin",
		env: { PATH: "/usr/bin" },
		providerSecrets: {},
	};
	return { get: async () => ok(captured), refresh: async () => ok(captured) };
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
		workspaceId: "workspace-1" as WorkspaceId,
		workspaceName: "alpha",
		workspacePath: "/work/alpha",
		repoRootPath: "/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 4100,
	};
}

function buildManager(agent: AgentSession, logger: Logger): DefaultSessionManager {
	const app = new FakeApp();
	const runner = new FakeRunner(agent);
	const registry = {
		get: () => ok(runner),
		all: () => [{ selector: { agent: "claude" as const }, runner }],
	};
	let nextId = 0;
	const createTurn = (): SessionTurn => ({
		start: async () => 1 as RunNumber,
		settled: async () => ({ kind: "success" }),
		cancel: async () => {},
	});
	const deps: SessionManagerDeps = {
		app,
		runners: registry,
		processes: new FakeProcesses(),
		checkpoints: new FakeCheckpoints(),
		prompt: new FakePrompt(),
		shellEnv: fakeShellEnv(),
		publisher: new FakePublisher(),
		liveState: new LiveStateStore({ app, flushed: async () => {} }),
		interactions: new FakeInteractions(),
		queue: createKeyedQueue(),
		models: new RunnerModelCatalog({ runners: registry, logger, clock: { now: () => 1000 } }),
		clock: { now: () => 1000 },
		ids: { uuid: () => `id-${++nextId}` },
		logger,
		createTurn,
	};
	return new DefaultSessionManager(deps);
}

function model(): ModelInfo {
	return {
		id: "sonnet",
		label: "Sonnet",
		status: "picker",
		isNew: false,
		isDefault: true,
		efforts: [],
		defaultEffort: "medium",
		effortAxis: "effort",
		liveEffortChange: false,
		supportsFastMode: false,
	};
}

function handlerDeps(manager: DefaultSessionManager, logger: Logger): HandlerDeps {
	const outbox: EventOutbox = {
		open: async () => ok([]),
		append: async (_sessionId, _events): Promise<Result<SessionEventEnvelope[], AppError>> =>
			ok([]),
		acknowledge: async (_sessionId, _eventId: EventId) => ok(undefined),
		pending: () => [],
		sessionsWithPending: () => [],
		sweepIdle: async () => ok(0),
	};
	const catalog: ModelCatalog = {
		list: async () => ok([model()]),
		validate: async () => ok(model()),
		invalidate: () => {},
	};
	const agents: AgentDetector = {
		detectAll: async () => [] as AgentInstall[],
		startLogin: async () => err(appError("agent_not_installed", "not installed")),
		finishLogin: async () => err(appError("agent_not_installed", "not installed")),
		cancelLogin: async () => ok(undefined),
	};
	const slashCommands: SlashCommandLister = { list: async () => ok([]) };
	const mcpServers: McpServerLister = { list: async () => ok([]) };
	const utilityPrompt: UtilityPromptRunner = { run: async () => ok({ text: "" }) };
	return {
		sessions: manager,
		outbox,
		models: catalog,
		agents,
		slashCommands,
		completions: { read: async () => ok(null), write: async () => ok(undefined) },
		mcpServers,
		usage: new SessionUsageReader({ logger, sessions: manager }),
		shellEnv: fakeShellEnv(),
		utilityPrompt,
		setLogLevel: () => {},
		logger,
	};
}

function logger(): Logger {
	return createLogger({
		sink: () => {},
		clock: { now: () => 1000 },
		level: "debug",
		scope: "models:usage-wiring",
	});
}

async function sendOne(manager: DefaultSessionManager): Promise<void> {
	const result = await manager.sendMessage({
		sessionId,
		messageId: "message-1" as MessageId,
		turnId: "turn-1" as TurnId,
		text: "hello",
		attachmentPaths: [],
		delivery: "new_turn",
		firstMessage: true,
		config: config(),
		workspace: workspace(),
		launch: { env: {}, providerKeys: {} },
	});
	expect(result).toEqual(ok({ deliveredAs: "new_turn" }));
}

describe("SIDE-17 the getContextUsage request is answered by a real session manager", () => {
	test("SIDE-17 the handler reads context usage and plan limits from the live agent", async () => {
		const limits: RateLimit[] = [
			{ label: "5-hour limit", usedPercent: 12, windowMinutes: 300, resetsAt: 1_800_000_000_000 },
		];
		const log = logger();
		const manager = buildManager(new FakeAgentSession(limits), log);
		const handlers = buildHandlers(handlerDeps(manager, log));
		await sendOne(manager);

		const answer = await handlers.requests.getContextUsage({ sessionId });

		expect(answer).toEqual(ok({ usedTokens: 11, windowTokens: 100, rateLimits: limits }));
	});

	test("SIDE-17 a chat the manager does not know answers session_unknown", async () => {
		const log = logger();
		const manager = buildManager(new FakeAgentSession([]), log);
		const handlers = buildHandlers(handlerDeps(manager, log));

		const answer = await handlers.requests.getContextUsage({ sessionId });

		expect(answer).toEqual(
			err(appError("session_unknown", "The sidecar has no state for this chat.")),
		);
	});
});
