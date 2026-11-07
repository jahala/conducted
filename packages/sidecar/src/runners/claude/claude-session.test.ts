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
import type {
	AgentMessage,
	Interaction,
	InteractionAnswer,
	ModelInfo,
	RemoteControlStatus,
	SessionConfig,
	WorkspaceContext,
} from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { countingIds } from "../../test-support/ids.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import { AsyncQueue } from "../../util/async-queue.ts";
import { NoActiveTurnError } from "../errors.ts";
import type { StartOptions, TurnCallbacks, TurnInput } from "../runner.ts";
import { ClaudeSession, type ClaudeSessionDeps, type QueryFunction } from "./claude-session.ts";
import { INTERRUPT_GRACE_MS, SETTLEMENT_WATCHDOG_MS } from "./constants.ts";
import { ClaudePermissionHandler, type PermissionHandlerDeps } from "./permission-handler.ts";
import { REMOTE_TEXT_ATTEMPTS, REMOTE_TEXT_RETRY_MS } from "./remote-control.ts";
import { ClaudeTranslator } from "./translate.ts";
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
		/** Each enableRemoteControl call, by its `enabled` argument. */
		remoteControl: boolean[];
	};
	models: SdkModelInfo[];
	commands: SlashCommand[];
	usage: { totalTokens: number; maxTokens: number };
	signal: AbortSignal | undefined;
	options: Options | undefined;
	onInterrupt: (() => void) | null;
	emit(message: SDKMessage): void;
}

function scriptedQuery(
	respond?: (message: SDKUserMessage, script: Script) => void,
	options: {
		setPermissionModeError?: Error;
		/** Gives the query object an enableRemoteControl method answering this way (RC-02). */
		remoteControl?: (enabled: boolean) => Promise<unknown>;
	} = {},
): {
	query: QueryFunction;
	script: Script;
} {
	const out = new AsyncQueue<SDKMessage>();
	const iterator = out[Symbol.asyncIterator]();
	const script: Script = {
		prompts: [],
		starts: 0,
		actions: { interrupt: 0, permissionModes: [], models: [], flags: [], remoteControl: [] },
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
			if (options.setPermissionModeError !== undefined) throw options.setPermissionModeError;
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
		...(options.remoteControl === undefined
			? {}
			: {
					enableRemoteControl: (enabled: boolean) => {
						script.actions.remoteControl.push(enabled);
						return options.remoteControl?.(enabled);
					},
				}),
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

function init(sessionId = "s1", permissionMode = "bypassPermissions"): SDKMessage {
	return {
		type: "system",
		subtype: "init",
		apiKeySource: "none",
		claude_code_version: "2.0.14",
		cwd: "/work/app",
		tools: [],
		mcp_servers: [],
		model: "claude-sonnet-5",
		permissionMode,
		slash_commands: [],
		output_style: "default",
		skills: [],
		plugins: [],
		uuid: "init-uuid",
		session_id: sessionId,
	} as unknown as SDKMessage;
}

function toolUseMessage(name: string, id = "tool-1", sessionId = "s1"): SDKMessage {
	return {
		type: "assistant",
		message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] },
		parent_tool_use_id: null,
		session_id: sessionId,
		uuid: "assistant-tool-uuid",
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

/** A catalog entry as the model catalog hands it to a chat's start (SIDE-14). */
function catalogModel(id: string, adaptiveThinking: boolean): ModelInfo {
	return {
		id,
		label: id,
		status: "picker",
		isNew: false,
		isDefault: false,
		efforts: ["low", "medium", "high", "xhigh", "max"],
		defaultEffort: "high",
		effortAxis: "effort",
		liveEffortChange: true,
		supportsFastMode: false,
		adaptiveThinking,
	};
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
		readUserMessageText: async () => null,
		realPath: async (path) => path,
		newUuid: countingIds("turn").uuid,
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
	/** Each enableRemoteControl call on this process, by its `enabled` argument (RC-02). */
	remoteControl: boolean[];
}

/** A query function that starts a fresh stream for every process, so a respawn is visible. */
function multiProcessQuery(
	onPrompt?: (message: SDKUserMessage, process: Process, index: number) => void,
	options: {
		closeOnAbort?: boolean;
		models?: SdkModelInfo[];
		remoteControl?: (enabled: boolean) => Promise<unknown>;
	} = {},
): { query: QueryFunction; processes: Process[] } {
	const processes: Process[] = [];
	const closeOnAbort = options.closeOnAbort ?? true;
	const query: QueryFunction = ({ prompt, options: queryOptions }) => {
		const stream = testStream<SDKMessage>();
		const process: Process = { stream, options: queryOptions, prompts: [], remoteControl: [] };
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
			supportedModels: async () => options.models ?? [],
			supportedCommands: async () => [],
			getContextUsage: async () => ({ totalTokens: 0, maxTokens: 0 }),
			...(options.remoteControl === undefined
				? {}
				: {
						enableRemoteControl: (enabled: boolean) => {
							process.remoteControl.push(enabled);
							return options.remoteControl?.(enabled);
						},
					}),
		} as unknown as Query;
	};
	return { query, processes };
}

function recordingLogger(): {
	logger: Logger;
	errors: { message: string; data?: Record<string, unknown> }[];
	debugLines: string[];
	taps: { message: string; data?: Record<string, unknown> }[];
} {
	const errors: { message: string; data?: Record<string, unknown> }[] = [];
	const debugLines: string[] = [];
	const taps: { message: string; data?: Record<string, unknown> }[] = [];
	const logger: Logger = {
		error: (message, data) => errors.push({ message, data }),
		warn: () => {},
		info: () => {},
		debug: (message, data) => {
			taps.push({ message, data });
			if (typeof data?.line === "string") debugLines.push(data.line);
		},
		child: () => logger,
		setLevel: () => {},
	};
	return { logger, errors, debugLines, taps };
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

	test("an API error turn shows one error and ends with an error outcome", async () => {
		const text = "API Error: 500 Internal server error";
		const { query } = scriptedQuery((user, s) => {
			s.emit(init());
			s.emit({
				...(assistantMessage(text) as object),
				error: "server_error",
			} as unknown as SDKMessage);
			s.emit({
				...(resultMessage(String(user.uuid)) as object),
				is_error: true,
				result: text,
				stop_reason: null,
			} as unknown as SDKMessage);
		});
		// The real translator, so the error items are the ones the app receives.
		const realTranslator = new ClaudeTranslator({ logger: fakeLogger() });
		const session = new ClaudeSession(makeDeps({ query, translator: realTranslator }), start());
		const messages: AgentMessage[] = [];

		const outcome = await session.runTurn(turnInput(), callbacks(messages));

		expect(outcome).toEqual({ kind: "error", message: text, retryable: false });
		const errors = messages.flatMap((message) => message.items).filter((i) => i.kind === "error");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ kind: "error", message: text });
		await session.dispose();
	});

	test("AGENT-18 a missing bundled skill is told to the user once per chat", async () => {
		const { query, script } = scriptedQuery((user, s) => {
			s.emit(init());
			s.emit(resultMessage(String(user.uuid)));
		});
		const session = new ClaudeSession(
			makeDeps({ query, skillPluginDir: "/nowhere/conducted-skill" }),
			start(),
		);
		const first: AgentMessage[] = [];
		const second: AgentMessage[] = [];

		expect(await session.runTurn(turnInput(), callbacks(first))).toEqual({ kind: "success" });
		expect(await session.runTurn(turnInput(), callbacks(second))).toEqual({ kind: "success" });

		const notices = (messages: AgentMessage[]) =>
			messages.flatMap((message) => message.items).filter((item) => item.kind === "notice");
		expect(notices(first)).toEqual([
			{
				kind: "notice",
				notice: "info",
				text: "The bundled skill folder /nowhere/conducted-skill was not found. This chat runs without the app's bundled skill, so Claude may not know the app's settings files and scripts.",
			},
		]);
		expect(notices(second)).toEqual([]);
		expect(script.options?.plugins).toBeUndefined();
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

	test("AGENT-02 a replaced process's late end does not finish the turn on its successor", async () => {
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

		const seen: AgentMessage[] = [];
		let secondOutcome: unknown = "pending";
		const second = session.runTurn(turnInput(), callbacks(seen));
		void second.then((outcome) => {
			secondOutcome = outcome;
		});
		await until(() => processes[1]?.prompts.length === 1);

		processes[0]?.stream.push(assistantMessage("late text from the old process"));
		processes[0]?.stream.close();
		await until(() => processes[0]?.stream.ended === true);
		await flushMicrotasks();

		expect(secondOutcome).toBe("pending");
		expect(seen).toHaveLength(0);
		const disposing = session.dispose();
		processes[1]?.stream.close();
		await disposing;
		await second;
	});

	test("AGENT-02 a cancel during the live config sync never sends the message", async () => {
		let releaseMode: () => void = () => {};
		const modeGate = new Promise<void>((resolve) => {
			releaseMode = resolve;
		});
		let modeCalls = 0;
		const base = multiProcessQuery();
		const query: QueryFunction = (args) => {
			const live = base.query(args);
			(live as { setPermissionMode: (mode: PermissionMode) => Promise<void> }).setPermissionMode =
				async () => {
					modeCalls += 1;
					await modeGate;
				};
			return live;
		};
		const scheduler = fakeScheduler();
		const session = new ClaudeSession(makeDeps({ query, scheduler }), start());

		const turn = session.runTurn(
			{ ...turnInput(), config: { ...config(), requireToolApproval: true } },
			callbacks([]),
		);
		await until(() => modeCalls === 1);
		const cancelling = session.cancel();
		await until(() => scheduler.pending() === 1);
		releaseMode();
		await flushMicrotasks();
		scheduler.fire(INTERRUPT_GRACE_MS);
		await cancelling;

		expect(await turn).toEqual({ kind: "cancelled" });
		expect(base.processes[0]?.prompts).toHaveLength(0);
		await session.dispose();
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

		test("AGENT-04 a failed live permission sync ends the turn before the message", async () => {
			const { query, script } = scriptedQuery(
				(user, s) => {
					s.emit(resultMessage(String(user.uuid)));
				},
				{ setPermissionModeError: new Error("the mode switch was refused") },
			);
			const session = new ClaudeSession(makeDeps({ query }), start());

			const outcome = await session.runTurn(
				{ ...turnInput(), config: { ...config(), requireToolApproval: true } },
				callbacks([]),
			);

			expect(outcome.kind).toBe("error");
			if (outcome.kind === "error") {
				expect(outcome.message).toContain("the mode switch was refused");
				expect(outcome.retryable).toBe(false);
			}
			expect(script.prompts).toHaveLength(0);
			await session.dispose();
		});

		test("AGENT-04 a deferred effort change the model cannot apply live restarts before the turn", async () => {
			const { query, processes } = multiProcessQuery(
				(message, process) => {
					process.stream.push(init());
					process.stream.push(resultMessage(String(message.uuid)));
				},
				{
					models: [
						{
							value: "claude-sonnet-5",
							displayName: "Sonnet",
							description: "",
							supportsEffort: false,
						},
					],
				},
			);
			let turnCount = 0;
			const session = new ClaudeSession(
				makeDeps({
					query,
					newUuid: () => {
						turnCount += 1;
						return `turn-${turnCount}`;
					},
				}),
				start(),
			);
			await session.warm();

			const outcome = await session.runTurn(
				{ ...turnInput(), config: { ...config(), effort: "low" } },
				callbacks([]),
			);

			expect(outcome).toEqual({ kind: "success" });
			expect(processes).toHaveLength(2);
			expect(processes[1]?.options?.effort).toBe("low");
			await session.dispose();
		});

		test("AGENT-04 an approved plan records the permission mode the CLI switched to", async () => {
			const planConfig = { ...config(), planMode: true, requireToolApproval: true };
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(
				makeDeps({
					query,
					createCanUseTool: (deps) => new ClaudePermissionHandler(deps).canUseTool,
				}),
				{ ...start(), config: planConfig },
			);
			const turn = session.runTurn(
				{ ...turnInput(), config: planConfig },
				callbacks([], {
					requestInteraction: async () => ({ kind: "plan_approval", approved: true }),
				}),
			);
			await until(() => script.prompts.length === 1);

			const approved = await script.options?.canUseTool?.(
				"ExitPlanMode",
				{ plan: "Change one file" },
				{ signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" },
			);

			expect(approved).toMatchObject({ behavior: "allow" });
			expect(script.actions.permissionModes).toEqual(["plan", "default"]);
			script.emit(resultMessage(String(script.prompts[0]?.uuid)));
			expect(await turn).toEqual({ kind: "success" });

			await session.applyConfig({ ...planConfig, planMode: false });

			// The approval's switch is already recorded, so the next sync does not re-send it.
			expect(script.actions.permissionModes).toEqual(["plan", "default"]);
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

		test("AGENT-16 a model without adaptive thinking starts with a thinking budget", async () => {
			const { query, script } = scriptedQuery();
			const looked: string[] = [];
			const session = new ClaudeSession(
				makeDeps({ query }),
				{
					...start(),
					lookUpModel: async (model) => {
						looked.push(model);
						return catalogModel(model, false);
					},
				},
			);
			await session.warm();

			expect(looked).toEqual(["claude-sonnet-5"]);
			expect(script.options?.thinking).toEqual({
				type: "enabled",
				budgetTokens: 16_000,
				display: "summarized",
			});
			await session.dispose();
		});

		test("AGENT-16 an effort change on a model without adaptive thinking restarts for its new budget", async () => {
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
			const session = new ClaudeSession(makeDeps({ query }), {
				...start(),
				lookUpModel: async (model) => catalogModel(model, false),
			});
			await session.warm();

			const result = await session.applyConfig({ ...config(), effort: "low" });

			expect(result).toBe("restart");
			expect(script.actions.flags).toHaveLength(0);
			await session.dispose();
		});

		test("AGENT-16 a live model change to one without adaptive thinking restarts", async () => {
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(makeDeps({ query }), {
				...start(),
				lookUpModel: async (model) => catalogModel(model, model === "claude-adaptive"),
			});
			await session.applyConfig({ ...config(), model: "claude-adaptive" });
			await session.warm();
			expect(script.options?.thinking).toEqual({ type: "adaptive", display: "summarized" });

			const result = await session.applyConfig({ ...config(), model: "claude-sonnet-5" });

			expect(result).toBe("restart");
			expect(script.actions.models).toHaveLength(0);
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

	describe("AGENT-05 steering", () => {
		test("AGENT-05 a steer gets a fresh uuid and stays pending until the mirror reports it read", async () => {
			let ids = 0;
			const { query, script } = scriptedQuery((_user, s) => {
				s.emit(init());
			});
			const session = new ClaudeSession(
				makeDeps({
					query,
					newUuid: () => {
						ids += 1;
						return `uuid-${ids}`;
					},
				}),
				start(),
			);
			let settled = false;
			const turn = session.runTurn(turnInput(), callbacks([])).then((outcome) => {
				settled = true;
				return outcome;
			});
			await until(() => script.prompts.length === 1);
			expect(String(script.prompts[0]?.uuid)).toBe("uuid-1");

			let read = false;
			const { consumed } = await session.steer({ ...turnInput(), text: "hold on" });
			void consumed.then(() => {
				read = true;
			});
			await until(() => script.prompts.length === 2);
			expect(String(script.prompts[1]?.uuid)).toBe("uuid-2");
			expect(script.prompts[1]?.message).toMatchObject({ role: "user", content: "hold on" });
			await flushMicrotasks();
			expect(read).toBe(false);

			// The result for the pre-steer message is held back while the steer is unread.
			script.emit(resultMessage("uuid-1"));
			await flushMicrotasks();
			expect(settled).toBe(false);

			// The CLI writes the steer into its transcript, so the receipt resolves.
			await script.options?.sessionStore?.append({ projectKey: "p", sessionId: "s1" }, [
				{ type: "user", uuid: "uuid-2" },
			]);
			await until(() => read === true);

			// The next result ends the turn.
			script.emit(resultMessage("uuid-2"));
			expect(await turn).toEqual({ kind: "success" });
			await session.dispose();
		});

		test("AGENT-05 steering is refused when no turn is open", async () => {
			let ids = 0;
			const { query } = scriptedQuery((user, s) => {
				s.emit(resultMessage(String(user.uuid)));
			});
			const session = new ClaudeSession(
				makeDeps({
					query,
					newUuid: () => {
						ids += 1;
						return `uuid-${ids}`;
					},
				}),
				start(),
			);

			await expect(session.steer(turnInput())).rejects.toBeInstanceOf(NoActiveTurnError);

			await session.runTurn(turnInput(), callbacks([]));
			await expect(session.steer(turnInput())).rejects.toBeInstanceOf(NoActiveTurnError);
			await session.dispose();
		});

		test("AGENT-05 a steer sent while the turn starts is queued after its first message", async () => {
			let releaseStart: () => void = () => {};
			const startGate = new Promise<void>((resolve) => {
				releaseStart = resolve;
			});
			let firstStart = true;
			let ids = 0;
			const { query, script } = scriptedQuery();
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
					newUuid: () => {
						ids += 1;
						return `uuid-${ids}`;
					},
				}),
				start(),
			);

			const turn = session.runTurn(turnInput(), callbacks([]));
			await until(() => !firstStart);
			const steered = session.steer({ ...turnInput(), text: "second" });
			releaseStart();
			await until(() => script.prompts.length === 2);

			expect(script.prompts[0]?.message).toMatchObject({ role: "user", content: "hi" });
			expect(script.prompts[1]?.message).toMatchObject({ role: "user", content: "second" });

			const { consumed } = await steered;
			await script.options?.sessionStore?.append({ projectKey: "p", sessionId: "s1" }, [
				{ type: "user", uuid: "uuid-2" },
			]);
			await consumed;
			script.emit(resultMessage("uuid-2"));
			expect(await turn).toEqual({ kind: "success" });
			await session.dispose();
		});
	});

	describe("SIDE-20 plan mode changes the agent made", () => {
		test("SIDE-20 an init that reports plan mode tells the app the chat entered plan mode", async () => {
			const changes: { config: SessionConfig; reason: string }[] = [];
			const { query } = scriptedQuery((message, s) => {
				s.emit(init("s1", "plan"));
				s.emit(resultMessage(String(message.uuid)));
			});
			const session = new ClaudeSession(makeDeps({ query }), {
				...start(),
				onConfigChanged: (config, reason) => changes.push({ config, reason }),
			});

			expect(await session.runTurn(turnInput(), callbacks([]))).toEqual({ kind: "success" });

			expect(changes).toHaveLength(1);
			expect(changes[0]?.reason).toBe("entered_plan_mode");
			expect(changes[0]?.config.planMode).toBe(true);
			await session.dispose();
		});

		test("SIDE-20 an EnterPlanMode call tells the app the chat entered plan mode", async () => {
			const changes: { config: SessionConfig; reason: string }[] = [];
			const { query } = scriptedQuery((message, s) => {
				s.emit(init());
				s.emit(toolUseMessage("EnterPlanMode"));
				s.emit(resultMessage(String(message.uuid)));
			});
			const session = new ClaudeSession(makeDeps({ query }), {
				...start(),
				onConfigChanged: (config, reason) => changes.push({ config, reason }),
			});

			expect(await session.runTurn(turnInput(), callbacks([]))).toEqual({ kind: "success" });

			expect(changes).toHaveLength(1);
			expect(changes[0]?.reason).toBe("entered_plan_mode");
			expect(changes[0]?.config.planMode).toBe(true);
			await session.dispose();
		});

		test("SIDE-20 an approved plan tells the app the chat left plan mode", async () => {
			const changes: { config: SessionConfig; reason: string }[] = [];
			const planConfig = { ...config(), planMode: true, requireToolApproval: true };
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(
				makeDeps({
					query,
					createCanUseTool: (deps) => new ClaudePermissionHandler(deps).canUseTool,
				}),
				{
					...start(),
					config: planConfig,
					onConfigChanged: (next, reason) => changes.push({ config: next, reason }),
				},
			);
			const turn = session.runTurn(
				{ ...turnInput(), config: planConfig },
				callbacks([], {
					requestInteraction: async () => ({ kind: "plan_approval", approved: true }),
				}),
			);
			await until(() => script.prompts.length === 1);

			const approved = await script.options?.canUseTool?.(
				"ExitPlanMode",
				{ plan: "Change one file" },
				{ signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" },
			);

			expect(approved).toMatchObject({ behavior: "allow" });
			expect(changes).toHaveLength(1);
			expect(changes[0]?.reason).toBe("left_plan_mode");
			expect(changes[0]?.config.planMode).toBe(false);
			script.emit(resultMessage(String(script.prompts[0]?.uuid)));
			expect(await turn).toEqual({ kind: "success" });
			await session.dispose();
		});

		test("SIDE-20 turning plan mode off in the app sends no agent config change", async () => {
			const changes: { config: SessionConfig; reason: string }[] = [];
			const { query } = scriptedQuery();
			const session = new ClaudeSession(makeDeps({ query }), {
				...start(),
				config: { ...config(), planMode: true },
				onConfigChanged: (next, reason) => changes.push({ config: next, reason }),
			});
			await session.warm();

			expect(await session.applyConfig({ ...config(), planMode: false })).toBe("applied");

			expect(changes).toHaveLength(0);
			await session.dispose();
		});

		test("SIDE-20 an init that reports plan after the app turned it off keeps the app's choice", async () => {
			const changes: { config: SessionConfig; reason: string }[] = [];
			const { query } = scriptedQuery((message, s) => {
				s.emit(init("s1", "plan"));
				s.emit(resultMessage(String(message.uuid)));
			});
			const session = new ClaudeSession(makeDeps({ query }), {
				...start(),
				config: { ...config(), planMode: true },
				onConfigChanged: (next, reason) => changes.push({ config: next, reason }),
			});
			await session.warm();
			await session.applyConfig({ ...config(), planMode: false });

			expect(
				await session.runTurn(
					{ ...turnInput(), config: { ...config(), planMode: false } },
					callbacks([]),
				),
			).toEqual({ kind: "success" });

			expect(changes).toHaveLength(0);
			await session.dispose();
		});

		test("SIDE-20 an exit and a re-entry in one turn are reported in order", async () => {
			const changes: { config: SessionConfig; reason: string }[] = [];
			const planConfig = { ...config(), planMode: true, requireToolApproval: true };
			const { query, script } = scriptedQuery();
			const session = new ClaudeSession(
				makeDeps({
					query,
					createCanUseTool: (deps) => new ClaudePermissionHandler(deps).canUseTool,
				}),
				{
					...start(),
					config: planConfig,
					onConfigChanged: (next, reason) => changes.push({ config: next, reason }),
				},
			);
			const turn = session.runTurn(
				{ ...turnInput(), config: planConfig },
				callbacks([], {
					requestInteraction: async () => ({ kind: "plan_approval", approved: true }),
				}),
			);
			await until(() => script.prompts.length === 1);

			const approved = await script.options?.canUseTool?.(
				"ExitPlanMode",
				{ plan: "Change one file" },
				{ signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" },
			);
			expect(approved).toMatchObject({ behavior: "allow" });

			script.emit(toolUseMessage("EnterPlanMode"));
			script.emit(resultMessage(String(script.prompts[0]?.uuid)));
			expect(await turn).toEqual({ kind: "success" });

			expect(changes.map((change) => change.reason)).toEqual([
				"left_plan_mode",
				"entered_plan_mode",
			]);
			await session.dispose();
		});
	});

	describe("AGENT-15 cancel during work the CLI started by itself", () => {
		function stateChanged(state: "running" | "idle"): SDKMessage {
			return {
				type: "system",
				subtype: "session_state_changed",
				state,
				uuid: `state-${state}`,
				session_id: "s1",
			} as unknown as SDKMessage;
		}

		/** A warm session whose CLI started work by itself, with the reports the host received. */
		async function workingByItself(scheduler: FakeScheduler) {
			const { query, script } = scriptedQuery();
			const reports: { inProgress: boolean; outcome: string | undefined }[] = [];
			const session = new ClaudeSession(makeDeps({ query, scheduler }), {
				...start(),
				selfStartedTurns: {
					onInProgressChanged: (inProgress, end) =>
						reports.push({ inProgress, outcome: end?.outcome }),
					onMessage: () => {},
					requestInteraction: async () => ({ kind: "withdrawn" }),
				},
			});
			await session.warm();
			script.emit(stateChanged("running"));
			script.emit(assistantMessage("Checking the build"));
			await until(() => reports.length === 1);
			return { session, script, reports };
		}

		test("AGENT-15 cancel interrupts the work and keeps the process when the work stops", async () => {
			const scheduler = fakeScheduler();
			const { session, script, reports } = await workingByItself(scheduler);
			script.onInterrupt = () => script.emit(stateChanged("idle"));

			await session.cancel();

			expect(script.actions.interrupt).toBe(1);
			expect(script.signal?.aborted).toBe(false);
			expect(reports.at(-1)).toEqual({ inProgress: false, outcome: "success" });
			await session.dispose();
		});

		test("AGENT-15 cancel stops the process when the work goes on after the interrupt grace", async () => {
			const scheduler = fakeScheduler();
			const { session, script, reports } = await workingByItself(scheduler);

			const cancelling = session.cancel();
			await until(() => scheduler.pending() === 1);
			scheduler.fire(INTERRUPT_GRACE_MS);
			await cancelling;

			expect(script.actions.interrupt).toBe(1);
			expect(script.signal?.aborted).toBe(true);
			// The stopped stream reports nothing more, so the work ends with the stop.
			expect(reports.at(-1)).toEqual({ inProgress: false, outcome: "interrupted" });
			await session.dispose();
		});
	});
});

describe("SIDE-18 SDK debug tap", () => {
	test("SIDE-18 a debug tap logs every SDK message in both directions", async () => {
		const recorder = recordingLogger();
		const { query } = scriptedQuery((user, script) => {
			script.emit(init());
			script.emit(assistantMessage("Hello"));
			script.emit(resultMessage(String(user.uuid)));
		});
		const session = new ClaudeSession(makeDeps({ query, logger: recorder.logger }), start());

		await session.runTurn(turnInput(), callbacks([]));

		const taps = recorder.taps.filter((tap) => tap.message === "workspace <> SDK");
		const upstream = taps.filter((tap) => tap.data?.direction === "upstream");
		const downstream = taps.filter((tap) => tap.data?.direction === "downstream");
		expect(upstream).toHaveLength(1);
		expect(upstream[0]?.data?.data).toMatchObject({
			type: "user",
			message: { role: "user", content: "hi" },
		});
		expect(downstream.length).toBeGreaterThanOrEqual(3);
		await session.dispose();
	});
});

describe("RC-02 Remote Control for a Claude chat", () => {
	const link = {
		session_url: "https://claude.ai/code/session_1",
		bridge_session_id: "session_1",
		bridge_epoch: 1,
	};
	const sessionUrl = link.session_url;

	function bridge(state: string, detail?: string): SDKMessage {
		return {
			type: "system",
			subtype: "bridge_state",
			state,
			...(detail === undefined ? {} : { detail }),
			bridge_epoch: 1,
			uuid: `bridge-${state}`,
			session_id: "s1",
		} as unknown as SDKMessage;
	}

	interface Recorded {
		statuses: RemoteControlStatus[];
		users: { uuid: string; text: Promise<string | null> }[];
		selfMessages: AgentMessage[];
		selfInteractions: Interaction[];
	}

	function remoteStart(
		remoteControl: boolean,
		env: Record<string, string> = { PATH: "/usr/bin" },
	): { options: StartOptions; recorded: Recorded } {
		const recorded: Recorded = {
			statuses: [],
			users: [],
			selfMessages: [],
			selfInteractions: [],
		};
		const options: StartOptions = {
			...start(),
			env,
			config: { ...config(), remoteControl },
			remoteControl: {
				onStatus: (status) => recorded.statuses.push(status),
				onUserMessage: (message) => recorded.users.push(message),
			},
			selfStartedTurns: {
				onInProgressChanged: () => {},
				onMessage: (message) => recorded.selfMessages.push(message),
				requestInteraction: (interaction) => {
					recorded.selfInteractions.push(interaction);
					return new Promise<InteractionAnswer>(() => {});
				},
			},
		};
		return { options, recorded };
	}

	test("RC-02 a chat with the switch on turns Remote Control on and reports the link and its state", async () => {
		const { query, script } = scriptedQuery(undefined, { remoteControl: async () => link });
		const { options, recorded } = remoteStart(true);
		const session = new ClaudeSession(makeDeps({ query }), options);

		await session.warm();
		await until(() => recorded.statuses.length >= 2);
		expect(script.actions.remoteControl).toEqual([true]);
		expect(recorded.statuses).toEqual([
			{ state: "connecting" },
			{ state: "connecting", sessionUrl },
		]);

		script.emit(bridge("ready"));
		script.emit(bridge("connected"));
		await until(() => recorded.statuses.length >= 4);
		expect(recorded.statuses.slice(2)).toEqual([
			{ state: "ready", sessionUrl },
			{ state: "connected", sessionUrl },
		]);

		await session.dispose();
		expect(recorded.statuses.at(-1)).toEqual({ state: "off" });
	});

	test("RC-02 a chat with the switch off never asks for Remote Control", async () => {
		const { query, script } = scriptedQuery(undefined, { remoteControl: async () => link });
		const { options, recorded } = remoteStart(false);
		const session = new ClaudeSession(makeDeps({ query }), options);

		await session.warm();
		await flushMicrotasks();
		expect(script.actions.remoteControl).toEqual([]);
		expect(recorded.statuses).toEqual([]);
		await session.dispose();
	});

	test("RC-02 a chat on an API key is unavailable, says why, and never asks the SDK", async () => {
		const { query, script } = scriptedQuery(undefined, { remoteControl: async () => link });
		const { options, recorded } = remoteStart(true, { PATH: "/usr/bin", ANTHROPIC_API_KEY: "k" });
		const session = new ClaudeSession(makeDeps({ query }), options);

		await session.warm();
		await until(() => recorded.statuses.length >= 1);
		expect(script.actions.remoteControl).toEqual([]);
		expect(recorded.statuses).toEqual([
			{
				state: "unavailable",
				detail: "Remote Control needs a claude.ai login. This chat runs on an API key.",
			},
		]);
		await session.dispose();
	});

	test("RC-02 an answer without the session link fails with a reason (contract, D074)", async () => {
		const { query } = scriptedQuery(undefined, {
			remoteControl: async () => ({ session_url: sessionUrl }),
		});
		const { options, recorded } = remoteStart(true);
		const session = new ClaudeSession(makeDeps({ query }), options);

		await session.warm();
		await until(() => recorded.statuses.length >= 2);
		expect(recorded.statuses[1]).toEqual({
			state: "failed",
			detail: "Claude turned Remote Control on but did not say where to open the chat.",
		});
		await session.dispose();
	});

	test("RC-02 an SDK without enableRemoteControl fails with a reason (contract, D074)", async () => {
		const { query } = scriptedQuery();
		const { options, recorded } = remoteStart(true);
		const session = new ClaudeSession(makeDeps({ query }), options);

		await session.warm();
		await until(() => recorded.statuses.length >= 2);
		expect(recorded.statuses[1]).toEqual({
			state: "failed",
			detail: "This version of the Claude Agent SDK cannot start Remote Control.",
		});
		await session.dispose();
	});

	test("RC-02 turning the switch off on a live chat turns Remote Control off", async () => {
		const { query, script } = scriptedQuery(undefined, {
			remoteControl: async (enabled) => (enabled ? link : undefined),
		});
		const { options, recorded } = remoteStart(true);
		const session = new ClaudeSession(makeDeps({ query }), options);
		await session.warm();
		await until(() => recorded.statuses.length >= 2);

		expect(await session.applyConfig({ ...config(), remoteControl: false })).toBe("applied");
		await until(() => recorded.statuses.at(-1)?.state === "off");
		expect(script.actions.remoteControl).toEqual([true, false]);
		await session.dispose();
	});

	test("RC-02 the switch turned on during a turn applies at once", async () => {
		const { query, script } = scriptedQuery(undefined, { remoteControl: async () => link });
		const { options, recorded } = remoteStart(false);
		const session = new ClaudeSession(makeDeps({ query }), options);
		const turn = session.runTurn(turnInput(), callbacks([]));
		await until(() => script.prompts.length === 1);

		session.setRemoteControl(true);
		await until(() => recorded.statuses.length >= 2);
		expect(script.actions.remoteControl).toEqual([true]);
		expect(recorded.statuses.at(-1)).toEqual({ state: "connecting", sessionUrl });

		script.emit(resultMessage(String(script.prompts[0]?.uuid)));
		expect(await turn).toEqual({ kind: "success" });
		await session.dispose();
	});

	test("RC-02 a process that ends drops the link, and the next process turns it on again", async () => {
		const { query, processes } = multiProcessQuery(undefined, {
			remoteControl: async () => link,
		});
		const { options, recorded } = remoteStart(true);
		const session = new ClaudeSession(makeDeps({ query }), options);
		await session.warm();
		await until(() => recorded.statuses.length >= 2);

		processes[0]?.stream.close();
		await until(() => recorded.statuses.at(-1)?.state === "disconnected");

		await session.warm();
		await until(() => processes[1]?.remoteControl.length === 1);
		await until(() => recorded.statuses.at(-1)?.sessionUrl === sessionUrl);
		expect(recorded.statuses.at(-1)).toEqual({ state: "connecting", sessionUrl });
		await session.dispose();
	});
});

describe("RC-03 input from claude.ai", () => {
	const link = {
		session_url: "https://claude.ai/code/session_1",
		bridge_session_id: "session_1",
		bridge_epoch: 1,
	};

	function answering(text: string, uuid = "remote-1", sessionId = "s1"): SDKMessage {
		return {
			type: "assistant",
			message: { role: "assistant", content: [{ type: "text", text }] },
			parent_tool_use_id: null,
			session_id: sessionId,
			uuid: `assistant-${uuid}`,
			user_message_uuid: uuid,
		} as unknown as SDKMessage;
	}

	function running(): SDKMessage {
		return {
			type: "system",
			subtype: "session_state_changed",
			state: "running",
			uuid: "state-running",
			session_id: "s1",
		} as unknown as SDKMessage;
	}

	/** The app sends the chat's stored switch with every message. */
	function remoteTurnInput(remoteControl = true): TurnInput {
		return { ...turnInput(), config: { ...config(), remoteControl } };
	}

	interface Recorded {
		users: { uuid: string; text: Promise<string | null> }[];
		selfMessages: AgentMessage[];
		selfInteractions: Interaction[];
	}

	function remoteStart(remoteControl: boolean): { options: StartOptions; recorded: Recorded } {
		const recorded: Recorded = { users: [], selfMessages: [], selfInteractions: [] };
		return {
			recorded,
			options: {
				...start(),
				config: { ...config(), remoteControl },
				remoteControl: {
					onStatus: () => {},
					onUserMessage: (message) => recorded.users.push(message),
				},
				selfStartedTurns: {
					onInProgressChanged: () => {},
					onMessage: (message) => recorded.selfMessages.push(message),
					requestInteraction: (interaction) => {
						recorded.selfInteractions.push(interaction);
						return new Promise<InteractionAnswer>(() => {});
					},
				},
			},
		};
	}

	async function connected(
		remoteControl: boolean,
		overrides: Partial<ClaudeSessionDeps> = {},
	): Promise<{
		session: ClaudeSession;
		script: Script;
		recorded: Recorded;
		permissions: () => PermissionHandlerDeps;
	}> {
		const { query, script } = scriptedQuery(undefined, { remoteControl: async () => link });
		const { options, recorded } = remoteStart(remoteControl);
		let captured: PermissionHandlerDeps | null = null;
		const session = new ClaudeSession(
			makeDeps({
				query,
				createCanUseTool: (deps) => {
					captured = deps;
					return new ClaudePermissionHandler(deps).canUseTool;
				},
				...overrides,
			}),
			options,
		);
		await session.warm();
		if (remoteControl) await until(() => script.actions.remoteControl.length === 1);
		await flushMicrotasks();
		return {
			session,
			script,
			recorded,
			permissions: () => {
				if (captured === null) throw new Error("the permission handler was not built");
				return captured;
			},
		};
	}

	test("RC-03 a message typed on claude.ai is reported with its text from Claude's transcript", async () => {
		const reads: { agentSessionId: string; cwd: string; uuid: string }[] = [];
		const { session, script, recorded } = await connected(true, {
			readUserMessageText: async (agentSessionId, cwd, uuid) => {
				reads.push({ agentSessionId, cwd, uuid });
				return uuid === "remote-1" ? "From the phone" : null;
			},
		});

		script.emit(init());
		script.emit(running());
		script.emit(answering("On it"));
		script.emit(answering("Still on it"));
		await until(() => recorded.users.length === 1);

		expect(recorded.users[0]?.uuid).toBe("remote-1");
		expect(await recorded.users[0]?.text).toBe("From the phone");
		expect(reads).toEqual([{ agentSessionId: "s1", cwd: "/work/app", uuid: "remote-1" }]);
		expect(recorded.selfMessages.flatMap((message) => message.items)).toContainEqual({
			kind: "text",
			text: "On it",
		});
		await flushMicrotasks();
		expect(recorded.users).toHaveLength(1);
		await session.dispose();
	});

	test("RC-03 the app's own messages are never reported as sent from claude.ai", async () => {
		const { session, script, recorded } = await connected(true, {
			readUserMessageText: async () => "unused",
		});
		const turn = session.runTurn(remoteTurnInput(), callbacks([]));
		await until(() => script.prompts.length === 1);
		const own = String(script.prompts[0]?.uuid);

		script.emit(answering("Hello", own));
		script.emit(resultMessage(own));
		expect(await turn).toEqual({ kind: "success" });
		await flushMicrotasks();
		expect(recorded.users).toEqual([]);
		await session.dispose();
	});

	test("RC-03 a message folded into the app's running turn from claude.ai is reported", async () => {
		const { session, script, recorded } = await connected(true, {
			readUserMessageText: async () => "Also add tests",
		});
		const turn = session.runTurn(remoteTurnInput(), callbacks([]));
		await until(() => script.prompts.length === 1);
		const own = String(script.prompts[0]?.uuid);

		script.emit({
			...(answering("Adding tests", "remote-2") as object),
			user_message_uuids: [own, "remote-2"],
		} as unknown as SDKMessage);
		await until(() => recorded.users.length === 1);
		expect(recorded.users[0]?.uuid).toBe("remote-2");
		expect(await recorded.users[0]?.text).toBe("Also add tests");

		script.emit(resultMessage(own));
		expect(await turn).toEqual({ kind: "success" });
		await session.dispose();
	});

	test("RC-03 with Remote Control off, an unknown uuid is not taken for claude.ai", async () => {
		const { session, script, recorded } = await connected(false, {
			readUserMessageText: async () => "unused",
		});
		script.emit(running());
		script.emit(answering("Background work"));
		await flushMicrotasks();
		expect(recorded.users).toEqual([]);
		await session.dispose();
	});

	test("RC-03 a transcript line written late is read again, and one never written reads as null", async () => {
		const scheduler = fakeScheduler();
		let available = false;
		let asked = 0;
		const { session, script, recorded } = await connected(true, {
			scheduler,
			readUserMessageText: async (_id, _cwd, uuid) => {
				asked += 1;
				return available && uuid === "remote-1" ? "Late text" : null;
			},
		});

		script.emit(running());
		script.emit(answering("First", "remote-1"));
		script.emit(answering("Second", "remote-9"));
		await until(() => recorded.users.length === 2);
		await until(() => asked === 2);

		available = true;
		scheduler.fire(REMOTE_TEXT_RETRY_MS);
		expect(await recorded.users[0]?.text).toBe("Late text");

		for (let attempt = 2; attempt < REMOTE_TEXT_ATTEMPTS; attempt += 1) {
			await flushMicrotasks();
			scheduler.fire(REMOTE_TEXT_RETRY_MS);
		}
		expect(await recorded.users[1]?.text).toBeNull();
		await session.dispose();
	});

	test("RC-03 an approval asked during work the CLI started goes to the host", async () => {
		const { session, permissions, recorded } = await connected(true, {
			readUserMessageText: async () => null,
		});
		const interaction: Interaction = {
			kind: "tool_approval",
			toolUseId: "tool-1" as never,
			toolName: "Bash",
			input: { command: "ls" },
		};
		const host = permissions().callbacks();
		expect(host).toBeDefined();
		void host?.requestInteraction(interaction, new AbortController().signal);
		expect(recorded.selfInteractions).toEqual([interaction]);
		await session.dispose();
	});

	test("RC-03 an approval answered on claude.ai closes the app's card and says so in the chat", async () => {
		const { session, script, permissions } = await connected(true, {
			readUserMessageText: async () => null,
		});
		const messages: AgentMessage[] = [];
		const turn = session.runTurn(
			remoteTurnInput(),
			callbacks(messages, { requestInteraction: () => new Promise<InteractionAnswer>(() => {}) }),
		);
		await until(() => script.prompts.length === 1);
		const sdkSignal = new AbortController();
		const interaction: Interaction = {
			kind: "tool_approval",
			toolUseId: "tool-1" as never,
			toolName: "Write",
			input: { file_path: "/work/app/a.ts" },
		};
		void permissions().callbacks()?.requestInteraction(interaction, sdkSignal.signal);

		sdkSignal.abort();
		await flushMicrotasks();
		expect(messages.flatMap((message) => message.items)).toContainEqual({
			kind: "notice",
			notice: "info",
			text: "Answered via Claude.",
		});

		script.emit(resultMessage(String(script.prompts[0]?.uuid)));
		expect(await turn).toEqual({ kind: "success" });
		await session.dispose();
	});

	test("RC-03 an approval answered in the app, or withdrawn with Remote Control off, says nothing", async () => {
		for (const remoteControl of [true, false]) {
			const { session, script, permissions } = await connected(remoteControl, {
				readUserMessageText: async () => null,
			});
			const messages: AgentMessage[] = [];
			let answer: (value: InteractionAnswer) => void = () => {};
			const turn = session.runTurn(
				remoteTurnInput(remoteControl),
				callbacks(messages, {
					requestInteraction: () =>
						new Promise<InteractionAnswer>((resolve) => {
							answer = resolve;
						}),
				}),
			);
			await until(() => script.prompts.length === 1);
			const sdkSignal = new AbortController();
			const pending = permissions()
				.callbacks()
				?.requestInteraction(
					{ kind: "tool_approval", toolUseId: "t" as never, toolName: "Bash", input: {} },
					sdkSignal.signal,
				);
			if (remoteControl) {
				answer({ kind: "tool_approval", decision: "allow" } as unknown as InteractionAnswer);
				await pending;
			}
			sdkSignal.abort();
			await flushMicrotasks();
			expect(
				messages.flatMap((message) => message.items).filter((item) => item.kind === "notice"),
			).toEqual([]);

			script.emit(resultMessage(String(script.prompts[0]?.uuid)));
			expect(await turn).toEqual({ kind: "success" });
			await session.dispose();
		}
	});
});
