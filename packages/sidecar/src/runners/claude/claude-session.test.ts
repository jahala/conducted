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
import { INTERRUPT_GRACE_MS } from "./constants.ts";
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
});
