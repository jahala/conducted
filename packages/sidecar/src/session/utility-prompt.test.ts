import { describe, expect, test } from "bun:test";
import type {
	AgentMessage,
	Interaction,
	InteractionAnswer,
	WorkspaceContext,
} from "@conducted/protocol";
import {
	type AcpAgent,
	type AgentKind,
	appError,
	ok,
	type SessionId,
	type ToolUseId,
} from "@conducted/shared";
import { createLogger, type LogLevel, type LogRecord } from "../logging/logger.ts";
import type { RunnerRegistry, RunnerSelector } from "../runners/registry.ts";
import type {
	AgentSession,
	Runner,
	RunnerCapabilities,
	StartOptions,
	TurnCallbacks,
	TurnInput,
	TurnOutcome,
} from "../runners/runner.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import { AgentUtilityPromptRunner } from "./utility-prompt.ts";

const capabilities: RunnerCapabilities = {
	steer: false,
	interrupt: true,
	resumeAt: false,
	liveConfig: false,
	slashCommands: false,
	mcpServers: false,
	contextUsage: false,
};

const textMessage = (text: string): AgentMessage => ({
	agent: "claude",
	items: [{ kind: "text", text }],
});

class FakeRunner implements Runner {
	readonly agent = "claude" as const;
	readonly capabilities = capabilities;
	readonly starts: StartOptions[] = [];
	readonly inputs: TurnInput[] = [];
	readonly answers: InteractionAnswer[] = [];
	cancels = 0;
	disposals = 0;
	readonly #startError: unknown;

	constructor(
		private readonly behavior: (callbacks: TurnCallbacks) => Promise<TurnOutcome>,
		startError?: unknown,
	) {
		this.#startError = startError;
	}

	async detect() {
		return null;
	}

	async start(options: StartOptions): Promise<AgentSession> {
		if (this.#startError !== undefined) throw this.#startError;
		this.starts.push(options);
		return this.session(options.sessionId);
	}

	async listModels() {
		return [];
	}

	async listSlashCommands() {
		return [];
	}

	private session(sessionId: SessionId): AgentSession {
		const runner = this;
		return {
			sessionId,
			async runTurn(input, callbacks) {
				runner.inputs.push(input);
				await callbacks.beforeFirstWrite();
				if (input.text === "ask for tools") {
					const kinds: Interaction[] = [
						{
							kind: "tool_approval",
							toolUseId: "tool-1" as ToolUseId,
							toolName: "Bash",
							input: {},
						},
						{ kind: "plan_approval", plan: "A plan" },
						{
							kind: "question",
							questions: [{ question: "Continue?", options: [], multiSelect: false }],
						},
						{
							kind: "permission_grant",
							description: "Network",
							paths: [],
							network: true,
						},
						{ kind: "mcp_form", server: "linear", message: "Fill", schema: {} },
					];
					for (const interaction of kinds) {
						runner.answers.push(await callbacks.requestInteraction(interaction));
					}
					callbacks.onMessage(textMessage("done"));
				}
				return runner.behavior(callbacks);
			},
			async steer() {
				return { consumed: Promise.resolve() };
			},
			async cancel() {
				runner.cancels += 1;
			},
			async applyConfig(): Promise<"applied"> {
				return "applied";
			},
			async contextUsage() {
				return null;
			},
			async dispose() {
				runner.disposals += 1;
			},
		};
	}
}

function registry(runner: Runner): RunnerRegistry {
	return {
		get: () => ok(runner),
		all: () => [{ selector: { agent: "claude" }, runner }],
	};
}

function shellEnv(): ShellEnvProvider {
	const captured = { shell: "/bin/zsh", path: "/usr/bin", env: { PATH: "/usr/bin" } };
	return {
		get: async () => ok(captured),
		refresh: async () => ok(captured),
	};
}

function logger(records: LogRecord[], level: LogLevel = "debug") {
	return createLogger({
		sink: (record) => records.push(record),
		clock: { now: () => 100 },
		level,
		scope: "utility-prompt-test",
	});
}

function ids() {
	let next = 0;
	return {
		uuid: () => {
			next += 1;
			return `id-${next}`;
		},
	};
}

interface UtilityParams {
	agent: AgentKind;
	acpAgent?: AcpAgent;
	model: string;
	prompt: string;
	cwd: string;
	fastMode: boolean;
	launch: {
		env: Record<string, string>;
		providerKeys: Record<string, { value: string; source: "entered" | "this_mac" }>;
	};
}

function params(changes: Partial<UtilityParams> = {}): UtilityParams {
	return {
		agent: "claude",
		model: "cheap-model",
		prompt: "Name this chat",
		cwd: "/work/alpha",
		fastMode: false,
		launch: { env: {}, providerKeys: {} },
		...changes,
	};
}

function runner(
	behavior: (callbacks: TurnCallbacks) => Promise<TurnOutcome>,
	options: {
		startError?: unknown;
		records?: LogRecord[];
		timeoutMs?: number;
		level?: LogLevel;
	} = {},
) {
	const fake = new FakeRunner(behavior, options.startError);
	const records = options.records ?? [];
	const service = new AgentUtilityPromptRunner({
		runners: registry(fake),
		shellEnv: shellEnv(),
		clock: { now: () => 100 },
		ids: ids(),
		logger: logger(records, options.level),
		timeoutMs: options.timeoutMs,
	});
	return { fake, service, records };
}

describe("SIDE-24 utility prompt success", () => {
	test("SIDE-24 returns the text items of the answer and ignores thinking", async () => {
		const { fake, service } = runner(async (callbacks) => {
			callbacks.onMessage({
				agent: "claude",
				items: [
					{ kind: "thinking", text: "not the answer", summarized: true },
					{ kind: "text", text: "Fix " },
				],
			});
			callbacks.onMessage(textMessage("login"));
			return { kind: "success" };
		});

		expect(await service.run(params())).toEqual(ok({ text: "Fix login" }));
		expect(fake.starts).toHaveLength(1);
		expect(fake.disposals).toBe(1);
		expect(fake.cancels).toBe(0);
	});

	test("SIDE-24 starts a throwaway session with a fresh id, tools off and the given model", async () => {
		const { fake, service } = runner(async () => ({ kind: "success" }));

		await service.run(params());
		await service.run(params());

		expect(fake.starts).toHaveLength(2);
		const first = fake.starts[0];
		const second = fake.starts[1];
		if (first === undefined || second === undefined) throw new Error("no start was recorded");
		expect(first.sessionId).not.toBe(second.sessionId);
		expect(first.config.model).toBe("cheap-model");
		expect(first.config.requireToolApproval).toBe(true);
		expect(first.config.appTools).toEqual({
			diffComments: false,
			progressUpdates: false,
			setTargetBranch: false,
		});
		expect(first.workspace.workspacePath).toBe("/work/alpha");
		expect(first.env).toMatchObject({
			PATH: "/usr/bin",
			CONDUCTED_WORKSPACE_PATH: "/work/alpha",
			DISABLE_AUTO_UPDATE: "true",
		});
	});

	test("SIDE-24 refuses every interaction and resolves beforeFirstWrite", async () => {
		const { fake, service } = runner(async () => ({ kind: "success" }));

		expect(await service.run(params({ prompt: "ask for tools" }))).toEqual(ok({ text: "done" }));

		expect(fake.answers).toEqual([
			{ kind: "tool_approval", decision: "deny" },
			{ kind: "plan_approval", approved: false },
			{ kind: "question", answers: [[]] },
			{ kind: "permission_grant", granted: false },
			{ kind: "mcp_form", action: "decline" },
		]);
	});

	test("SIDE-24 collects only text and ignores background tasks and agent session ids", async () => {
		const { fake, service } = runner(async (callbacks) => {
			callbacks.onMessage(textMessage("title"));
			callbacks.onBackgroundTasks([{ id: "bg", kind: "other", description: "work" }], 100);
			callbacks.onAgentSessionId("agent-session");
			callbacks.onFastModeUnavailable();
			return { kind: "success" };
		});

		expect(await service.run(params())).toEqual(ok({ text: "title" }));
		expect(fake.disposals).toBe(1);
	});

	test("SIDE-24 logs a completed call at info with its phase and duration", async () => {
		const records: LogRecord[] = [];
		const { service } = runner(
			async (callbacks) => {
				callbacks.onMessage(textMessage("A title"));
				return { kind: "success" };
			},
			{ records, level: "info" },
		);

		await service.run(
			params({
				launch: {
					env: { PRIVATE_SETTING: "not-a-secret" },
					providerKeys: { ANTHROPIC_API_KEY: { value: "sk-secret", source: "entered" } },
				},
			}),
		);

		const finished = records.find((record) => record.data?.phase === "completed");
		expect(finished).toBeDefined();
		expect(finished?.level).toBe("info");
		expect(typeof finished?.data?.durationMs).toBe("number");
		expect(JSON.stringify(records)).not.toContain("sk-secret");
		expect(JSON.stringify(records)).not.toContain("not-a-secret");
	});
});

describe("SIDE-21 utility prompt launch", () => {
	test("SIDE-21 the launch's variables and own provider key reach the throwaway runner", async () => {
		const { fake, service } = runner(async () => ({ kind: "success" }));

		await service.run(
			params({
				launch: {
					env: { FROM_THE_USER: "yes" },
					providerKeys: {
						ANTHROPIC_API_KEY: { value: "secret-anthropic", source: "entered" },
						OPENAI_API_KEY: { value: "secret-openai", source: "entered" },
					},
				},
			}),
		);

		const started = fake.starts[0];
		if (started === undefined) throw new Error("no start was recorded");
		expect(started.env.FROM_THE_USER).toBe("yes");
		expect(started.env.ANTHROPIC_API_KEY).toBe("secret-anthropic");
		expect(started.env.OPENAI_API_KEY).toBeUndefined();
	});
});

describe("SIDE-24 utility prompt failures", () => {
	test("SIDE-24 with no model returns an error and starts nothing", async () => {
		const { fake, service } = runner(async () => ({ kind: "success" }));

		const result = await service.run(params({ model: "   " }));

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("utility_prompt_model_missing");
		expect(fake.starts).toHaveLength(0);
	});

	test("SIDE-24 an agent that is not signed in returns its error and disposes nothing", async () => {
		const failure = appError("agent_auth_required", "Sign in to Claude Code");
		const { fake, service } = runner(async () => ({ kind: "success" }), {
			startError: failure,
		});

		expect(await service.run(params())).toEqual({ ok: false, error: failure });
		expect(fake.disposals).toBe(0);
	});

	test("SIDE-24 an error outcome is returned and the session is disposed", async () => {
		const { fake, service } = runner(async () => ({
			kind: "error",
			message: "The agent stopped",
			retryable: false,
		}));

		const result = await service.run(params());

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("utility_prompt_failed");
			expect(result.error.message).toBe("The agent stopped");
		}
		expect(fake.disposals).toBe(1);
	});

	test("SIDE-24 a thrown runTurn is returned as an error and the session is disposed", async () => {
		const { fake, service } = runner(async () => {
			throw new Error("boom");
		});

		const result = await service.run(params());

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("utility_prompt_failed");
			expect(result.error.message).toContain("boom");
		}
		expect(fake.disposals).toBe(1);
	});

	test("SIDE-24 an empty answer is an error and the session is disposed", async () => {
		const { fake, service } = runner(async () => ({ kind: "success" }));

		const result = await service.run(params());

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("utility_prompt_empty");
		expect(fake.disposals).toBe(1);
	});

	test("SIDE-24 a call that runs too long is cancelled and disposed", async () => {
		const { fake, service } = runner(() => new Promise<TurnOutcome>(() => {}), {
			timeoutMs: 5,
		});

		const result = await service.run(params());

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("utility_prompt_timeout");
		expect(fake.cancels).toBe(1);
		expect(fake.disposals).toBe(1);
	});
});

describe("SIDE-24 utility prompt configuration", () => {
	test("SIDE-24 runs a prompt through the ACP and Cursor runners", async () => {
		const selectors: RunnerSelector[] = [];
		const fake = new FakeRunner(async (callbacks) => {
			callbacks.onMessage(textMessage("done"));
			return { kind: "success" };
		});
		const service = new AgentUtilityPromptRunner({
			runners: {
				get: (selector) => {
					selectors.push(selector);
					return ok(fake);
				},
				all: () => [{ selector: { agent: "claude" }, runner: fake }],
			},
			shellEnv: shellEnv(),
			clock: { now: () => 100 },
			ids: ids(),
			logger: logger([]),
		});

		await service.run(params({ agent: "acp", acpAgent: "opencode" }));
		await service.run(params({ agent: "cursor" }));

		expect(selectors).toEqual([{ agent: "acp", acpAgent: "opencode" }, { agent: "cursor" }]);
		expect(fake.starts[0]?.config).toMatchObject({ agent: "acp", acpAgent: "opencode" });
		expect(fake.starts[1]?.config).toMatchObject({ agent: "cursor" });
	});

	test("SIDE-24 passes the fast-mode switch and the prompt to the agent", async () => {
		const { fake, service } = runner(async () => ({ kind: "success" }));

		await service.run(params({ fastMode: true, prompt: "Name this branch" }));

		const input = fake.inputs[0];
		const start = fake.starts[0];
		if (input === undefined || start === undefined) throw new Error("no call was recorded");
		expect(input.text).toBe("Name this branch");
		expect(input.config.fastMode).toBe(true);
		expect(input.attachmentPaths).toEqual([]);
		const workspace: WorkspaceContext = start.workspace;
		expect(start.config.planMode).toBe(false);
		expect(workspace.repoRootPath).toBe("/work/alpha");
	});
});

describe("SIDE-24 utility prompt log lines", () => {
	const secretLaunch = {
		env: { PRIVATE_SETTING: "not-a-secret-value" },
		providerKeys: { ANTHROPIC_API_KEY: { value: "sk-secret-value", source: "entered" as const } },
	};
	const allowed = new Set(["agent", "phase", "durationMs", "reason"]);

	test("SIDE-24 a call logs only its agent, phase, duration and reason, whether it succeeds, fails or times out", async () => {
		const records: LogRecord[] = [];
		const succeeding = runner(
			async (callbacks) => {
				callbacks.onMessage(textMessage("A title"));
				return { kind: "success" };
			},
			{ records },
		);
		const failing = runner(
			async () => ({ kind: "error", message: "The agent stopped", retryable: false }),
			{
				records,
			},
		);
		const timing = runner(() => new Promise<TurnOutcome>(() => {}), { records, timeoutMs: 5 });

		await succeeding.service.run(params({ launch: secretLaunch }));
		await failing.service.run(params({ launch: secretLaunch }));
		await timing.service.run(params({ launch: secretLaunch }));

		const phases = records.map((record) => record.data?.phase);
		expect(phases).toEqual(["started", "completed", "started", "failed", "started", "failed"]);
		for (const record of records) {
			for (const name of Object.keys(record.data ?? {})) expect(allowed.has(name)).toBe(true);
		}
		const text = JSON.stringify(records);
		expect(text).not.toContain("sk-secret-value");
		expect(text).not.toContain("not-a-secret-value");
		expect(text).not.toContain("Name this chat");
	});
});
