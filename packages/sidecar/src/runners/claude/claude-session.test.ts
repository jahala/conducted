import { describe, expect, test } from "bun:test";
import type {
	CanUseTool,
	Options,
	PermissionMode,
	Query,
	SDKMessage,
	SDKUserMessage,
	ModelInfo as SdkModelInfo,
	SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage, SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import type { StartOptions, TurnCallbacks, TurnInput } from "../runner.ts";
import { ClaudeSession, type ClaudeSessionDeps, type QueryFunction } from "./claude-session.ts";
import { INTERRUPT_GRACE_MS, SETTLEMENT_WATCHDOG_MS } from "./constants.ts";
import { ClaudePermissionHandler } from "./permission-handler.ts";
import type { ClaudeTranslator } from "./translate.ts";
import type { Scheduler } from "./turn-tracker.ts";

interface FakeScheduler extends Scheduler {
	pending(): number;
	fire(ms: number): void;
}

function fakeScheduler(): FakeScheduler {
	const tasks: { ms: number; fn: () => void; cancelled: boolean }[] = [];
	return {
		after(ms, fn) {
			const task = { ms, fn, cancelled: false };
			tasks.push(task);
			return () => {
				task.cancelled = true;
			};
		},
		pending() {
			return tasks.filter((task) => !task.cancelled).length;
		},
		fire(ms) {
			for (const task of tasks) {
				if (task.cancelled || task.ms !== ms) continue;
				task.cancelled = true;
				task.fn();
			}
		},
	};
}

function fakeLogger(): Logger {
	const logger: Logger = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => logger,
		setLevel: () => {},
	};
	return logger;
}

function translator(): ClaudeTranslator {
	const fake = {
		translate(message: SDKMessage): AgentMessage[] {
			if (message.type !== "assistant") return [];
			const content = message.message.content;
			const items: AgentMessage["items"] = [];
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "text") items.push({ kind: "text", text: block.text });
				}
			}
			return items.length === 0 ? [] : [{ agent: "claude", items, raw: message }];
		},
	};
	return fake as unknown as ClaudeTranslator;
}

interface Script {
	prompts: SDKUserMessage[];
	starts: number;
	actions: {
		interrupt: number;
		permissionModes: PermissionMode[];
		models: string[];
		flags: unknown[];
	};
	models: SdkModelInfo[];
	commands: SlashCommand[];
	usage: { totalTokens: number; maxTokens: number };
	signal: AbortSignal | undefined;
	options: Options | undefined;
	onInterrupt: (() => void) | null;
	emit(message: SDKMessage): void;
}

function scriptedQuery(respond?: (message: SDKUserMessage, script: Script) => void): {
	query: QueryFunction;
	script: Script;
} {
	const out = new AsyncQueue<SDKMessage>();
	const iterator = out[Symbol.asyncIterator]();
	const script: Script = {
		prompts: [],
		starts: 0,
		actions: { interrupt: 0, permissionModes: [], models: [], flags: [] },
		models: [],
		commands: [],
		usage: { totalTokens: 0, maxTokens: 0 },
		signal: undefined,
		options: undefined,
		onInterrupt: null,
		emit: (message) => {
			out.push(message);
		},
	};
	const query = {
		next: () => iterator.next(),
		return: async () => {
			out.close();
			return { value: undefined, done: true };
		},
		throw: async (error: unknown) => {
			out.close();
			throw error;
		},
		[Symbol.asyncIterator]() {
			return this;
		},
		interrupt: async () => {
			script.actions.interrupt += 1;
			script.onInterrupt?.();
			return undefined;
		},
		setPermissionMode: async (mode: PermissionMode) => {
			script.actions.permissionModes.push(mode);
		},
		setModel: async (model?: string) => {
			script.actions.models.push(model ?? "");
		},
		applyFlagSettings: async (settings: unknown) => {
			script.actions.flags.push(settings);
		},
		supportedModels: async () => script.models,
		supportedCommands: async () => script.commands,
		getContextUsage: async () => script.usage,
	} as unknown as Query;

	const queryFn: QueryFunction = ({ prompt, options }) => {
		script.starts += 1;
		script.options = options;
		script.signal = options?.abortController?.signal;
		options?.abortController?.signal.addEventListener("abort", () => out.close(), { once: true });
		void (async () => {
			for await (const message of prompt) {
				script.prompts.push(message);
				respond?.(message, script);
			}
		})();
		return query;
	};
	return { query: queryFn, script };
}

function init(sessionId = "s1"): SDKMessage {
	return {
		type: "system",
		subtype: "init",
		apiKeySource: "none",
		claude_code_version: "2.0.14",
		cwd: "/work/app",
		tools: [],
		mcp_servers: [],
		model: "claude-sonnet-5",
		permissionMode: "bypassPermissions",
		slash_commands: [],
		output_style: "default",
		skills: [],
		plugins: [],
		uuid: "init-uuid",
		session_id: sessionId,
	} as unknown as SDKMessage;
}

function assistantMessage(text: string, sessionId = "s1"): SDKMessage {
	return {
		type: "assistant",
		message: { role: "assistant", content: [{ type: "text", text }] },
		parent_tool_use_id: null,
		session_id: sessionId,
		uuid: "assistant-uuid",
	} as unknown as SDKMessage;
}

function resultMessage(uuid: string, sessionId = "s1"): SDKMessage {
	return {
		type: "result",
		subtype: "success",
		is_error: false,
		num_turns: 1,
		user_message_uuid: uuid,
		duration_ms: 1,
		duration_api_ms: 1,
		stop_reason: "end_turn",
		total_cost_usd: 0.1,
		usage: {},
		modelUsage: {},
		permission_denials: [],
		errors: [],
		result: "",
		uuid: "result-uuid",
		session_id: sessionId,
	} as unknown as SDKMessage;
}

function taskStarted(taskId: string, description: string, taskType = "local_bash"): SDKMessage {
	return {
		type: "system",
		subtype: "task_started",
		task_id: taskId,
		description,
		task_type: taskType,
		uuid: "task-uuid",
		session_id: "s1",
	} as unknown as SDKMessage;
}

function config(): SessionConfig {
	return {
		agent: "claude",
		model: "claude-sonnet-5",
		effort: "high",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
	};
}

function workspace(): WorkspaceContext {
	return {
		workspaceId: "w1" as WorkspaceId,
		workspaceName: "app",
		workspacePath: "/work/app",
		repoRootPath: "/work/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 4100,
	};
}

function start(): StartOptions {
	return {
		sessionId: "s1" as SessionId,
		config: config(),
		workspace: workspace(),
		env: { PATH: "/usr/bin" },
	};
}

function turnInput(): TurnInput {
	return { text: "hi", attachmentPaths: [], config: config() };
}

function callbacks(
	messages: AgentMessage[],
	overrides: Partial<TurnCallbacks> = {},
): TurnCallbacks {
	return {
		onMessage: (message) => messages.push(message),
		requestInteraction: async () => ({ kind: "withdrawn" }),
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
		...overrides,
	};
}

function makeDeps(overrides: Partial<ClaudeSessionDeps> = {}): ClaudeSessionDeps {
	return {
		query: scriptedQuery().query,
		executablePath: "/bin/claude",
		appTools: {} as AppToolBackend,
		logger: fakeLogger(),
		translator: translator(),
		hasTranscript: async () => false,
		realPath: async (path) => path,
		newUuid: () => "turn-uuid",
		scheduler: fakeScheduler(),
		createCanUseTool: () =>
			(async () => ({ behavior: "allow", updatedInput: {} })) as unknown as CanUseTool,
		createMcpServers: () => ({}),
		...overrides,
	};
}

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error("condition never became true");
}

/** Lets the promises of one stream ending run, without waiting on wall-clock time. */
async function flushMicrotasks(times = 20): Promise<void> {
	for (let attempt = 0; attempt < times; attempt += 1) await Promise.resolve();
}

interface Stream<T> {
	push(value: T): void;
	close(): void;
	fail(error: Error): void;
	ended: boolean;
	[Symbol.asyncIterator](): AsyncIterator<T>;
}

/** A stream a test can end normally or with an error, like the SDK's process transport. */
function testStream<T>(): Stream<T> {
	const buffer: T[] = [];
	let waiting: { resolve(result: IteratorResult<T>): void; reject(error: unknown): void } | null =
		null;
	let closed = false;
	let failure: Error | null = null;
	const stream: Stream<T> = {
		ended: false,
		push(value) {
			if (closed || failure !== null) return;
			if (waiting !== null) {
				const settle = waiting;
				waiting = null;
				settle.resolve({ value, done: false });
			} else {
				buffer.push(value);
			}
		},
		close() {
			if (closed) return;
			closed = true;
			stream.ended = true;
			if (waiting !== null) {
				const settle = waiting;
				waiting = null;
				settle.resolve({ value: undefined, done: true });
			}
		},
		fail(error) {
			failure = error;
			stream.ended = true;
			if (waiting !== null) {
				const settle = waiting;
				waiting = null;
				settle.reject(error);
			}
		},
		[Symbol.asyncIterator]() {
			return {
				next: () => {
					if (buffer.length > 0) {
						return Promise.resolve({ value: buffer.shift() as T, done: false });
					}
					if (failure !== null) {
						stream.ended = true;
						return Promise.reject(failure);
					}
					if (closed) {
						stream.ended = true;
						return Promise.resolve({ value: undefined, done: true });
					}
					return new Promise<IteratorResult<T>>((resolve, reject) => {
						waiting = { resolve, reject };
					});
				},
			};
		},
	};
	return stream;
}

interface Process {
	stream: Stream<SDKMessage>;
	options: Options | undefined;
	prompts: SDKUserMessage[];
}

/** A query function that starts a fresh stream for every process, so a respawn is visible. */
function multiProcessQuery(
	onPrompt?: (message: SDKUserMessage, process: Process, index: number) => void,
	options: { closeOnAbort?: boolean } = {},
): { query: QueryFunction; processes: Process[] } {
	const processes: Process[] = [];
	const closeOnAbort = options.closeOnAbort ?? true;
	const query: QueryFunction = ({ prompt, options: queryOptions }) => {
		const stream = testStream<SDKMessage>();
		const process: Process = { stream, options: queryOptions, prompts: [] };
		const index = processes.length;
		processes.push(process);
		queryOptions?.abortController?.signal.addEventListener(
			"abort",
			() => {
				if (closeOnAbort) stream.close();
			},
			{ once: true },
		);
		void (async () => {
			for await (const message of prompt) {
				process.prompts.push(message);
				onPrompt?.(message, process, index);
			}
		})();
		const iterator = stream[Symbol.asyncIterator]();
		return {
			next: () => iterator.next(),
			return: async () => {
				stream.close();
				return { value: undefined, done: true };
			},
			throw: async (error: unknown) => {
				throw error;
			},
			[Symbol.asyncIterator]() {
				return this;
			},
			interrupt: async () => {},
			setPermissionMode: async () => {},
			setModel: async () => {},
			applyFlagSettings: async () => {},
			supportedModels: async () => [],
			supportedCommands: async () => [],
			getContextUsage: async () => ({ totalTokens: 0, maxTokens: 0 }),
		} as unknown as Query;
	};
	return { query, processes };
}

function recordingLogger(): {
	logger: Logger;
	errors: { message: string; data?: Record<string, unknown> }[];
	debugLines: string[];
} {
	const errors: { message: string; data?: Record<string, unknown> }[] = [];
	const debugLines: string[] = [];
	const logger: Logger = {
		error: (message, data) => errors.push({ message, data }),
		warn: () => {},
		info: () => {},
		debug: (_message, data) => {
			if (typeof data?.line === "string") debugLines.push(data.line);
		},
		child: () => logger,
		setLevel: () => {},
	};
	return { logger, errors, debugLines };
}

describe("AGENT-02 Claude session", () => {
	test("runTurn pushes the message and settles on its result, emitting the text", async () => {
		const { query, script } = scriptedQuery((user, s) => {
			s.emit(init());
			s.emit(assistantMessage("Hello"));
			s.emit(resultMessage(String(user.uuid)));
		});
		const session = new ClaudeSession(makeDeps({ query }), start());
		const messages: AgentMessage[] = [];

		const outcome = await session.runTurn(turnInput(), callbacks(messages));

		expect(outcome).toEqual({ kind: "success" });
		expect(messages.flatMap((message) => message.items)).toContainEqual({
			kind: "text",
			text: "Hello",
		});
		expect(script.prompts).toHaveLength(1);
		expect(script.prompts[0]?.message).toMatchObject({ role: "user", content: "hi" });
		await session.dispose();
	});

	test("two starts at once share one process", async () => {
		const { query, script } = scriptedQuery();
		const session = new ClaudeSession(makeDeps({ query }), start());

		await Promise.all([session.warm(), session.warm()]);

		expect(script.starts).toBe(1);
		await session.dispose();
	});

	test("a second turn while one runs is refused", async () => {
		const { query, script } = scriptedQuery();
		const session = new ClaudeSession(makeDeps({ query }), start());
		const first = session.runTurn(turnInput(), callbacks([]));
		await until(() => script.prompts.length === 1);

		const second = await session.runTurn(turnInput(), callbacks([]));
		expect(second).toMatchObject({ kind: "error" });

		await session.dispose();
		expect(await first).toEqual({ kind: "cancelled" });
	});

	test("cancel interrupts first and keeps the process when the turn ends", async () => {
		let seenUser: (message: SDKUserMessage) => void = () => {};
		const userSeen = new Promise<SDKUserMessage>((resolve) => {
			seenUser = resolve;
		});
		const { query, script } = scriptedQuery((user, s) => {
			seenUser(user);
			s.onInterrupt = () => s.emit(resultMessage(String(user.uuid)));
		});
		const session = new ClaudeSession(makeDeps({ query }), start());

		const turn = session.runTurn(turnInput(), callbacks([]));
		await userSeen;
		await session.cancel();

		expect(await turn).toEqual({ kind: "cancelled" });
		expect(script.actions.interrupt).toBe(1);
		expect(script.signal?.aborted).toBe(false);
		await session.dispose();
	});

	test("cancel stops the process after the interrupt grace", async () => {
		const scheduler = fakeScheduler();
		let seenUser: (message: SDKUserMessage) => void = () => {};
		const userSeen = new Promise<SDKUserMessage>((resolve) => {
			seenUser = resolve;
		});
		const { query, script } = scriptedQuery((user) => {
			seenUser(user);
		});
		const session = new ClaudeSession(makeDeps({ query, scheduler }), start());

		const turn = session.runTurn(turnInput(), callbacks([]));
		await userSeen;
		const cancelling = session.cancel();
		await until(() => scheduler.pending() === 1);
		scheduler.fire(INTERRUPT_GRACE_MS);
		await cancelling;

		expect(await turn).toEqual({ kind: "cancelled" });
		expect(script.actions.interrupt).toBe(1);
		expect(script.signal?.aborted).toBe(true);
	});

	test("the first message reports the agent session id", async () => {
		const { query } = scriptedQuery((user, s) => {
			s.emit(init("agent-1"));
			s.emit(resultMessage(String(user.uuid), "agent-1"));
		});
		const session = new ClaudeSession(makeDeps({ query }), start());
		const ids: string[] = [];

		await session.runTurn(turnInput(), callbacks([], { onAgentSessionId: (id) => ids.push(id) }));

		expect(ids).toEqual(["agent-1"]);
		await session.dispose();
	});

	test("the fast-mode refusal on stderr is reported", async () => {
		let unavailable = 0;
		const { query } = scriptedQuery((user, s) => {
			s.options?.stderr?.("Fast mode requires extra usage billing");
			s.emit(resultMessage(String(user.uuid)));
		});
		const session = new ClaudeSession(makeDeps({ query }), start());

		await session.runTurn(
			turnInput(),
			callbacks([], { onFastModeUnavailable: () => (unavailable += 1) }),
		);

		expect(unavailable).toBe(1);
		await session.dispose();
	});

	test("context usage comes from the live query and is null without a process", async () => {
		const { query, script } = scriptedQuery();
		script.usage = { totalTokens: 1234, maxTokens: 200_000 };
		const session = new ClaudeSession(makeDeps({ query }), start());

		expect(await session.contextUsage()).toBeNull();
		await session.warm();
		expect(await session.contextUsage()).toEqual({ usedTokens: 1234, windowTokens: 200_000 });
		await session.dispose();
	});

	test("dispose aborts the process", async () => {
		const { query, script } = scriptedQuery();
		const session = new ClaudeSession(makeDeps({ query }), start());

		await session.warm();
		await session.dispose();

		expect(script.signal?.aborted).toBe(true);
	});

	test("a crashed turn reports the exit code and stderr tail, and the next turn resumes", async () => {
		const recorder = recordingLogger();
		let turnCount = 0;
		const { query, processes } = multiProcessQuery((message, process, index) => {
			if (index === 0) {
				process.options?.stderr?.("fatal: out of memory");
				const error = Object.assign(new Error("Claude Code process exited"), {
					code: "process_exit",
					exitCode: 7,
					signal: "SIGKILL",
				});
				process.stream.fail(error);
				return;
			}
			process.stream.push(init());
			process.stream.push(resultMessage(String(message.uuid)));
		});
		let hasTranscript = false;
		const session = new ClaudeSession(
			makeDeps({
				query,
				logger: recorder.logger,
				hasTranscript: async () => hasTranscript,
				newUuid: () => {
					turnCount += 1;
					return `turn-${turnCount}`;
				},
			}),
			start(),
		);

		const failed = await session.runTurn(turnInput(), callbacks([]));

		expect(failed.kind).toBe("error");
		if (failed.kind === "error") {
			expect(failed.message).toContain("exit code 7");
			expect(failed.message).toContain("signal SIGKILL");
			expect(failed.message).toContain("fatal: out of memory");
		}
		expect(recorder.errors[0]?.data).toMatchObject({
			errorClass: "Error",
			code: "process_exit",
			exitCode: 7,
			signal: "SIGKILL",
			stderrTail: "fatal: out of memory",
		});

		hasTranscript = true;
		const second = await session.runTurn(turnInput(), callbacks([]));

		expect(second).toEqual({ kind: "success" });
		expect(processes).toHaveLength(2);
		expect(processes[1]?.options?.resume).toBe("s1");
		expect(processes[1]?.options?.sessionId).toBeUndefined();
		await session.dispose();
	});

	test("a stream that ends mid-turn reports the stderr tail", async () => {
		const { query } = multiProcessQuery((_message, process) => {
			process.options?.stderr?.("the CLI crashed");
			process.stream.close();
		});
		const session = new ClaudeSession(makeDeps({ query }), start());

		const outcome = await session.runTurn(turnInput(), callbacks([]));

		expect(outcome.kind).toBe("error");
		if (outcome.kind === "error") {
			expect(outcome.message).toContain("ended unexpectedly");
			expect(outcome.message).toContain("the CLI crashed");
		}
		await session.dispose();
	});

	test("an old stream ending does not release the process that replaced it", async () => {
		const scheduler = fakeScheduler();
		const { query, processes } = multiProcessQuery(undefined, { closeOnAbort: false });
		const session = new ClaudeSession(makeDeps({ query, scheduler }), start());

		const first = session.runTurn(turnInput(), callbacks([]));
		await until(() => processes[0]?.prompts.length === 1);
		const cancelling = session.cancel();
		await until(() => scheduler.pending() === 1);
		scheduler.fire(INTERRUPT_GRACE_MS);
		await cancelling;
		expect(await first).toEqual({ kind: "cancelled" });

		const second = session.runTurn(turnInput(), callbacks([]));
		await until(() => processes[1]?.prompts.length === 1);

		processes[0]?.stream.close();
		await until(() => processes[0]?.stream.ended === true);
		await flushMicrotasks();

		let disposed = false;
		const disposing = session.dispose().then(() => {
			disposed = true;
		});
		await flushMicrotasks();
		expect(disposed).toBe(false);

		processes[1]?.stream.close();
		await disposing;
		expect(disposed).toBe(true);
		await second;
	});

	test("dispose waits for the process stream to end", async () => {
		const { query, processes } = multiProcessQuery(undefined, { closeOnAbort: false });
		const session = new ClaudeSession(makeDeps({ query }), start());
		await session.warm();

		let disposed = false;
		const disposing = session.dispose().then(() => {
			disposed = true;
		});
		await flushMicrotasks();
		expect(disposed).toBe(false);

		processes[0]?.stream.close();
		await disposing;
		expect(disposed).toBe(true);
	});

	test("a stop during the start never sends the message", async () => {
		let releaseStart: () => void = () => {};
		const startGate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		let firstStart = true;
		const { query, processes } = multiProcessQuery();
		const session = new ClaudeSession(
			makeDeps({
				query,
				hasTranscript: async () => {
					if (firstStart) {
						firstStart = false;
						await startGate;
					}
					return false;
				},
			}),
			start(),
		);

		const turn = session.runTurn(turnInput(), callbacks([]));
		await until(() => !firstStart);
		await session.cancel();
		releaseStart();

		expect(await turn).toEqual({ kind: "cancelled" });
		expect(processes[0]?.prompts).toHaveLength(0);
		await session.dispose();
	});

	test("a foreign result leaves the turn open until the watchdog settles it", async () => {
		const scheduler = fakeScheduler();
		const { query } = multiProcessQuery((_message, process) => {
			process.stream.push(init());
			process.stream.push(resultMessage("another-turn"));
		});
		const session = new ClaudeSession(makeDeps({ query, scheduler }), start());

		let settled = false;
		const turn = session.runTurn(turnInput(), callbacks([])).then((outcome) => {
			settled = true;
			return outcome;
		});
		await until(() => scheduler.pending() === 1);
		expect(settled).toBe(false);

		scheduler.fire(SETTLEMENT_WATCHDOG_MS);
		expect(await turn).toEqual({ kind: "success" });
		await session.dispose();
	});

	test("debug stderr lines are dropped and other lines are kept", async () => {
		const recorder = recordingLogger();
		const { query } = multiProcessQuery((message, process) => {
			process.options?.stderr?.("[DEBUG] noise");
			process.options?.stderr?.("real problem");
			process.stream.push(resultMessage(String(message.uuid)));
		});
		const session = new ClaudeSession(makeDeps({ query, logger: recorder.logger }), start());

		await session.runTurn(turnInput(), callbacks([]));

		expect(recorder.debugLines).toContain("real problem");
		expect(recorder.debugLines).not.toContain("[DEBUG] noise");
		await session.dispose();
	});

	test("the session-state flag reaches the child environment", async () => {
		const { query, processes } = multiProcessQuery((message, process) => {
			process.stream.push(resultMessage(String(message.uuid)));
		});
		const session = new ClaudeSession(makeDeps({ query }), start());

		await session.runTurn(turnInput(), callbacks([]));

		expect(processes[0]?.options?.env).toMatchObject({
			CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
		});
		await session.dispose();
	});

	test("background task messages reach onBackgroundTasks", async () => {
		const { query } = multiProcessQuery((message, process) => {
			process.stream.push(taskStarted("task-1", "Run tests"));
			process.stream.push(resultMessage(String(message.uuid)));
		});
		const session = new ClaudeSession(makeDeps({ query }), start());
		const tasks: Parameters<TurnCallbacks["onBackgroundTasks"]>[0][] = [];

		await session.runTurn(
			turnInput(),
			callbacks([], { onBackgroundTasks: (list) => tasks.push(list) }),
		);

		expect(tasks).toContainEqual([{ id: "task-1", kind: "shell", description: "Run tests" }]);
		await session.dispose();
	});

	test("a fork start reaches the process as resume, session id, point and forkSession", async () => {
		const { query, processes } = multiProcessQuery((message, process) => {
			process.stream.push(resultMessage(String(message.uuid)));
		});
		const session = new ClaudeSession(makeDeps({ query, hasTranscript: async () => false }), {
			...start(),
			resume: { agentSessionId: "source-session", atNativeMessageId: "message-5" },
		});

		await session.runTurn(turnInput(), callbacks([]));

		expect(processes[0]?.options).toMatchObject({
			resume: "source-session",
			sessionId: "s1",
			resumeSessionAt: "message-5",
			forkSession: true,
		});
		await session.dispose();
	});

	describe("AGENT-04 live configuration", () => {
		test("AGENT-04 a model change reaches the live process with setModel", async () => {
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(makeDeps({ query }), start());
			await session.warm();

			const result = await session.applyConfig({ ...config(), model: "claude-opus-5" });

			expect(result).toBe("applied");
			expect(script.actions.models).toEqual(["claude-opus-5"]);
			await session.dispose();
		});

		test("AGENT-04 plan mode, approvals and auto mode switch the live permission mode", async () => {
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(makeDeps({ query }), start());
			await session.warm();

			await session.applyConfig({ ...config(), planMode: true });
			await session.applyConfig({ ...config(), requireToolApproval: true });
			await session.applyConfig({
				...config(),
				requireToolApproval: true,
				autoPermissionMode: true,
			});

			expect(script.actions.permissionModes).toEqual(["plan", "default", "auto"]);
			await session.dispose();
		});

		test("AGENT-04 setAutoApproveEdits lets the live chat accept an edit without asking", async () => {
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(
				makeDeps({
					query,
					createCanUseTool: (deps) => new ClaudePermissionHandler(deps).canUseTool,
				}),
				{ ...start(), config: { ...config(), requireToolApproval: true } },
			);
			await session.warm();

			session.setAutoApproveEdits(true);
			const result = await script.options?.canUseTool?.(
				"Edit",
				{ file_path: "/work/app/src/a.ts" },
				{ signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" },
			);

			expect(result).toMatchObject({ behavior: "allow" });
			await session.dispose();
		});

		test("AGENT-04 an unsupported effort change asks for a restart", async () => {
			const { query, script } = scriptedQuery();
			script.models = [
				{
					value: "claude-sonnet-5",
					displayName: "Sonnet",
					description: "",
					supportsEffort: false,
				},
			];
			const session = new ClaudeSession(makeDeps({ query }), start());
			await session.warm();

			const result = await session.applyConfig({ ...config(), effort: "low" });

			expect(result).toBe("restart");
			expect(script.actions.flags).toHaveLength(0);
			await session.dispose();
		});

		test("AGENT-04 a supported effort change is applied live", async () => {
			const { query, script } = scriptedQuery();
			script.models = [
				{
					value: "claude-sonnet-5",
					displayName: "Sonnet",
					description: "",
					supportsEffort: true,
					supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
				},
			];
			const session = new ClaudeSession(makeDeps({ query }), start());
			await session.warm();

			const result = await session.applyConfig({ ...config(), effort: "low" });

			expect(result).toBe("applied");
			expect(script.actions.flags).toEqual([{ effortLevel: "low" }]);
			await session.dispose();
		});

		test("AGENT-04 a restart-only change is reported without touching the process", async () => {
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(makeDeps({ query }), start());
			await session.warm();

			const result = await session.applyConfig({ ...config(), fastMode: true });

			expect(result).toBe("restart");
			expect(script.actions.models).toHaveLength(0);
			expect(script.actions.permissionModes).toHaveLength(0);
			await session.dispose();
		});

		test("AGENT-04 a config change during a turn waits for the next turn", async () => {
			const { query, script } = scriptedQuery();
			let turnCount = 0;
			const session = new ClaudeSession(
				makeDeps({
					query,
					// Distinct uuids per turn, as the real IdSource gives: a repeated uuid is treated
					// as a result for the turn that already ended.
					newUuid: () => {
						turnCount += 1;
						return `turn-${turnCount}`;
					},
				}),
				start(),
			);
			const turn = session.runTurn(turnInput(), callbacks([]));
			await until(() => script.prompts.length === 1);

			const result = await session.applyConfig({ ...config(), model: "claude-opus-5" });

			expect(result).toBe("applied");
			expect(script.actions.models).toHaveLength(0);
			const firstUuid = String(script.prompts[0]?.uuid);
			script.emit(resultMessage(firstUuid));
			expect(await turn).toEqual({ kind: "success" });

			const nextConfig = { ...config(), model: "claude-opus-5" };
			const next = session.runTurn({ ...turnInput(), config: nextConfig }, callbacks([]));
			await until(() => script.prompts.length === 2);

			expect(script.actions.models).toEqual(["claude-opus-5"]);
			const secondUuid = String(script.prompts[1]?.uuid);
			script.emit(resultMessage(secondUuid));
			expect(await next).toEqual({ kind: "success" });
			await session.dispose();
		});

		test("AGENT-04 config applied before the process starts is used at start", async () => {
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(makeDeps({ query }), start());

			const result = await session.applyConfig({ ...config(), model: "claude-opus-5" });

			expect(result).toBe("applied");
			expect(script.starts).toBe(0);
			await session.warm();
			expect(script.options?.model).toBe("claude-opus-5");
			await session.dispose();
		});
	});
});
