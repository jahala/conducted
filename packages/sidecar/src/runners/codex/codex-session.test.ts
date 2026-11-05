/**
 * @feature AGENT-06 Codex: threads, steer, interrupt
 * Owns: tests for the thread lifecycle, turns, steering, cancel, resume fallback, retries and
 * context usage of codex-session.ts.
 * Test first: runTurn sends thread/start then turn/start and resolves success.
 */
import { describe, expect, test } from "bun:test";
import type { AgentMessage, SessionConfig } from "@conducted/protocol";
import {
	type AppError,
	appError,
	err,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { createLogger } from "../../logging/logger.ts";
import { NoActiveTurnError } from "../errors.ts";
import type { StartOptions, TurnCallbacks, TurnInput } from "../runner.ts";
import type { CodexAppServerClient } from "./app-server-client.ts";
import {
	CODEX_RATE_LIMIT_RETRIES,
	CodexSession,
	friendlyCodexError,
	isCodexRateLimitError,
} from "./codex-session.ts";
import { CODEX_SERVER_NOTIFICATIONS } from "./protocol.ts";
import type { CodexTranslator } from "./translate.ts";

type RequestAnswer = (params: unknown, client: FakeClient) => Result<unknown, AppError>;

class FakeClient implements CodexAppServerClient {
	readonly requests: { method: string; params: unknown }[] = [];
	answers = new Map<string, RequestAnswer>();
	closed = false;

	private notificationListeners = new Map<string, Set<(params: unknown) => void>>();
	private closeListeners: ((reason: string) => void)[] = [];

	async connect(): Promise<Result<{ serverVersion: string }, AppError>> {
		return ok({ serverVersion: "0.154.0" });
	}

	async request<T>(method: string, params: unknown): Promise<Result<T, AppError>> {
		this.requests.push({ method, params });
		const answer = this.answers.get(method);
		if (answer === undefined) return ok(undefined as T);
		return answer(params, this) as Result<T, AppError>;
	}

	onNotification(method: string, listener: (params: unknown) => void): () => void {
		let listeners = this.notificationListeners.get(method);
		if (listeners === undefined) {
			listeners = new Set();
			this.notificationListeners.set(method, listeners);
		}
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	onServerRequest(): void {}

	onClose(listener: (reason: string) => void): void {
		this.closeListeners.push(listener);
	}

	async close(): Promise<void> {
		this.closed = true;
	}

	emit(method: string, params: unknown): void {
		for (const listener of this.notificationListeners.get(method) ?? []) listener(params);
	}

	exit(reason: string): void {
		for (const listener of this.closeListeners) listener(reason);
	}

	methods(): string[] {
		return this.requests.map((request) => request.method);
	}
}

const baseConfig: SessionConfig = {
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: ["/workspace"],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const startOptions = (resume?: string): StartOptions => ({
	sessionId: "session-1" as SessionId,
	config: baseConfig,
	workspace: {
		workspaceId: "workspace-1" as WorkspaceId,
		workspaceName: "one",
		workspacePath: "/workspace",
		repoRootPath: "/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 4310,
	},
	env: {},
	...(resume === undefined ? {} : { resume: { agentSessionId: resume } }),
});

const turnInput = (text = "hello", config = baseConfig): TurnInput => ({
	text,
	attachmentPaths: [],
	config,
});

function callbacks(): TurnCallbacks {
	return {
		onMessage: (_message: AgentMessage) => {},
		requestInteraction: async () => ({ kind: "withdrawn" }),
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
	};
}

function translator(): CodexTranslator {
	return {
		translateItem: () => [],
		translateNotification: () => [],
	} as unknown as CodexTranslator;
}

function logger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test:codex",
	});
}

function makeSession(
	client: FakeClient,
	options: {
		resume?: string;
		random?: () => number;
		sleeps?: number[];
	} = {},
): CodexSession {
	return new CodexSession(
		{
			connectClient: async () => client,
			translator: translator(),
			logger: logger(),
			random: options.random ?? (() => 0),
			sleep: async (ms) => {
				options.sleeps?.push(ms);
			},
		},
		startOptions(options.resume),
	);
}

function answerThreadStart(client: FakeClient): void {
	client.answers.set("thread/start", () => ok({ thread: { id: "thread-1" }, model: "gpt-5" }));
}

function answerCompletedTurn(client: FakeClient, id = "turn-1"): void {
	client.answers.set("turn/start", () => {
		queueMicrotask(() => {
			client.emit(CODEX_SERVER_NOTIFICATIONS.turnCompleted, {
				threadId: "thread-1",
				turn: { id, status: "completed", error: null },
			});
		});
		return ok({ turn: { id, status: "inProgress", error: null } });
	});
}

async function waitFor(predicate: () => boolean): Promise<void> {
	while (!predicate()) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("AGENT-06 Codex session", () => {
	test("runTurn sends thread/start then turn/start and succeeds on a completed turn", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		answerCompletedTurn(client);
		const session = makeSession(client);

		const outcome = await session.runTurn(turnInput(), callbacks());

		expect(outcome).toEqual({ kind: "success" });
		expect(client.methods().slice(0, 2)).toEqual(["thread/start", "turn/start"]);
		const start = client.requests[0]?.params as { cwd: string; model: string };
		expect(start.cwd).toBe("/workspace");
		expect(start.model).toBe("gpt-5");
		const turn = client.requests[1]?.params as {
			threadId: string;
			input: { type: string; text: string; text_elements: unknown[] }[];
		};
		expect(turn.threadId).toBe("thread-1");
		expect(turn.input[0]).toEqual({ type: "text", text: "hello", text_elements: [] });
	});

	test("a follow-up goes to the same Codex thread", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		answerCompletedTurn(client);
		const session = makeSession(client);

		expect(await session.runTurn(turnInput("one"), callbacks())).toEqual({ kind: "success" });
		expect(await session.runTurn(turnInput("two"), callbacks())).toEqual({ kind: "success" });

		expect(client.methods().filter((method) => method === "thread/start")).toHaveLength(1);
		const turns = client.requests.filter((request) => request.method === "turn/start");
		expect(turns).toHaveLength(2);
		expect(turns[1]?.params).toMatchObject({ threadId: "thread-1" });
	});

	test("steer uses turn/steer with the active turn id, and without one throws", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		client.answers.set("turn/start", () => {
			client.emit(CODEX_SERVER_NOTIFICATIONS.turnStarted, {
				threadId: "thread-1",
				turn: { id: "turn-9", status: "inProgress", error: null },
			});
			return ok({ turn: { id: "turn-9", status: "inProgress", error: null } });
		});
		client.answers.set("turn/steer", () => ok({}));
		client.answers.set("turn/interrupt", () => ok({}));
		const session = makeSession(client);

		await expect(session.steer(turnInput("not yet"))).rejects.toBeInstanceOf(NoActiveTurnError);

		const running = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.requests.some((request) => request.method === "turn/start"));
		const { consumed } = await session.steer(turnInput("keep going"));
		await consumed;

		const steer = client.requests.find((request) => request.method === "turn/steer");
		expect(steer?.params).toMatchObject({ threadId: "thread-1", expectedTurnId: "turn-9" });
		expect(steer?.params).toMatchObject({ input: [{ type: "text", text: "keep going" }] });

		await session.cancel();
		expect(await running).toEqual({ kind: "cancelled" });
	});

	test("cancel interrupts the turn and retries once with the server's active turn id", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		client.answers.set("turn/start", () => {
			queueMicrotask(() => {
				client.emit(CODEX_SERVER_NOTIFICATIONS.turnStarted, {
					threadId: "thread-1",
					turn: { id: "turn-server", status: "inProgress", error: null },
				});
			});
			return ok({ turn: { id: "turn-local", status: "inProgress", error: null } });
		});
		let interrupts = 0;
		client.answers.set("turn/interrupt", (params) => {
			interrupts += 1;
			const turnId = (params as { turnId: string }).turnId;
			return turnId === "turn-local"
				? err(appError("codex_rpc_error", "turn id does not match"))
				: ok({});
		});
		const session = makeSession(client);

		const running = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.requests.some((request) => request.method === "turn/start"));
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await session.cancel();

		expect(interrupts).toBe(2);
		const interruptsSent = client.requests
			.filter((request) => request.method === "turn/interrupt")
			.map((request) => (request.params as { turnId: string }).turnId);
		expect(interruptsSent).toEqual(["turn-local", "turn-server"]);
		expect(await running).toEqual({ kind: "cancelled" });
	});

	test("resume uses thread/resume and falls back to a new thread on failure", async () => {
		const fallingBack = new FakeClient();
		fallingBack.answers.set("thread/resume", () =>
			err(appError("codex_rpc_error", "that thread is gone")),
		);
		answerThreadStart(fallingBack);
		answerCompletedTurn(fallingBack);
		const fallbackSession = makeSession(fallingBack, { resume: "thread-old" });

		expect(await fallbackSession.runTurn(turnInput(), callbacks())).toEqual({ kind: "success" });
		expect(fallingBack.methods().slice(0, 2)).toEqual(["thread/resume", "thread/start"]);

		const resuming = new FakeClient();
		resuming.answers.set("thread/resume", () =>
			ok({ thread: { id: "thread-old" }, model: "gpt-5" }),
		);
		answerCompletedTurn(resuming);
		const resumedSession = makeSession(resuming, { resume: "thread-old" });

		expect(await resumedSession.runTurn(turnInput(), callbacks())).toEqual({ kind: "success" });
		expect(resuming.methods()).not.toContain("thread/start");
		const resumed = resuming.requests[0]?.params as { threadId: string };
		expect(resumed.threadId).toBe("thread-old");
	});

	test("resume does not fall back when Codex refuses the sign-in", async () => {
		const client = new FakeClient();
		client.answers.set("thread/resume", () =>
			err(appError("codex_rpc_error", "you are not signed in")),
		);
		const session = makeSession(client, { resume: "thread-old" });

		const outcome = await session.runTurn(turnInput(), callbacks());

		expect(outcome.kind).toBe("error");
		expect(client.methods()).toEqual(["thread/resume"]);
	});

	test("applyConfig keeps live changes and asks for a restart when the thread shape changes", async () => {
		const client = new FakeClient();
		const session = makeSession(client);

		expect(await session.applyConfig({ ...baseConfig, model: "gpt-5-mini" })).toBe("applied");
		expect(
			await session.applyConfig({ ...baseConfig, additionalDirectories: ["/workspace", "/other"] }),
		).toBe("restart");
		expect(
			await session.applyConfig({
				...baseConfig,
				appTools: { diffComments: false, progressUpdates: true, setTargetBranch: true },
			}),
		).toBe("restart");
	});

	test("contextUsage reports the last token usage and its window", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		const usage = {
			total: {
				totalTokens: 100,
				inputTokens: 70,
				cachedInputTokens: 0,
				cacheWriteInputTokens: 0,
				outputTokens: 30,
				reasoningOutputTokens: 0,
			},
			last: {
				totalTokens: 100,
				inputTokens: 70,
				cachedInputTokens: 0,
				cacheWriteInputTokens: 0,
				outputTokens: 30,
				reasoningOutputTokens: 0,
			},
			modelContextWindow: 128_000,
		};
		client.answers.set("turn/start", () => {
			queueMicrotask(() => {
				client.emit(CODEX_SERVER_NOTIFICATIONS.tokenUsageUpdated, {
					threadId: "thread-1",
					tokenUsage: usage,
				});
				client.emit(CODEX_SERVER_NOTIFICATIONS.turnCompleted, {
					threadId: "thread-1",
					turn: { id: "turn-1", status: "completed", error: null },
				});
			});
			return ok({ turn: { id: "turn-1", status: "inProgress", error: null } });
		});
		const session = makeSession(client);

		expect(await session.contextUsage()).toBeNull();
		expect(await session.runTurn(turnInput(), callbacks())).toEqual({ kind: "success" });
		expect(await session.contextUsage()).toEqual({
			usedTokens: 100,
			windowTokens: 128_000,
		});
	});

	test("rate-limit failures retry up to four times with jittered backoff", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		let attempts = 0;
		client.answers.set("turn/start", () => {
			attempts += 1;
			if (attempts <= CODEX_RATE_LIMIT_RETRIES) {
				return err(appError("codex_rpc_error", "rate limit exceeded (429)"));
			}
			queueMicrotask(() => {
				client.emit(CODEX_SERVER_NOTIFICATIONS.turnCompleted, {
					threadId: "thread-1",
					turn: { id: "turn-1", status: "completed", error: null },
				});
			});
			return ok({ turn: { id: "turn-1", status: "inProgress", error: null } });
		});
		const sleeps: number[] = [];
		const session = makeSession(client, { sleeps, random: () => 0.5 });

		const outcome = await session.runTurn(turnInput(), callbacks());

		expect(outcome).toEqual({ kind: "success" });
		expect(attempts).toBe(CODEX_RATE_LIMIT_RETRIES + 1);
		expect(sleeps).toHaveLength(CODEX_RATE_LIMIT_RETRIES);
		expect(sleeps[1]).toBeGreaterThan(sleeps[0] ?? 0);
	});

	test("an interrupted turn is cancelled and a failed turn carries a friendly message", async () => {
		const interrupted = new FakeClient();
		answerThreadStart(interrupted);
		interrupted.answers.set("turn/start", () => {
			queueMicrotask(() => {
				interrupted.emit(CODEX_SERVER_NOTIFICATIONS.turnCompleted, {
					threadId: "thread-1",
					turn: { id: "turn-1", status: "interrupted", error: null },
				});
			});
			return ok({ turn: { id: "turn-1", status: "inProgress", error: null } });
		});
		expect(await makeSession(interrupted).runTurn(turnInput(), callbacks())).toEqual({
			kind: "cancelled",
		});

		const failed = new FakeClient();
		answerThreadStart(failed);
		failed.answers.set("turn/start", () => {
			queueMicrotask(() => {
				failed.emit(CODEX_SERVER_NOTIFICATIONS.turnCompleted, {
					threadId: "thread-1",
					turn: {
						id: "turn-1",
						status: "failed",
						error: { message: "You have reached your usage limit." },
					},
				});
			});
			return ok({ turn: { id: "turn-1", status: "inProgress", error: null } });
		});
		const outcome = await makeSession(failed).runTurn(turnInput(), callbacks());
		expect(outcome.kind).toBe("error");
		expect(outcome.kind === "error" && outcome.retryable).toBe(true);
		expect(outcome.kind === "error" && outcome.message).toContain("usage limit");
	});

	test("a closed app server fails the running turn and is recreated for the next", async () => {
		const first = new FakeClient();
		answerThreadStart(first);
		first.answers.set("turn/start", () => {
			queueMicrotask(() => first.exit("the transport closed"));
			return ok({ turn: { id: "turn-1", status: "inProgress", error: null } });
		});
		const second = new FakeClient();
		second.answers.set("thread/resume", () => ok({ thread: { id: "thread-1" } }));
		answerCompletedTurn(second);
		let connections = 0;
		const session = new CodexSession(
			{
				connectClient: async () => {
					connections += 1;
					return connections === 1 ? first : second;
				},
				translator: translator(),
				logger: logger(),
				random: () => 0,
				sleep: async () => {},
			},
			startOptions(),
		);

		const failed = await session.runTurn(turnInput("one"), callbacks());
		expect(failed.kind).toBe("error");
		const recovered = await session.runTurn(turnInput("two"), callbacks());
		expect(recovered).toEqual({ kind: "success" });
		expect(connections).toBe(2);
		expect(second.methods()[0]).toBe("thread/resume");
	});
});

test("AGENT-06 friendly Codex errors name usage limits and shared accounts", () => {
	expect(isCodexRateLimitError("429 Too Many Requests")).toBe(true);
	expect(friendlyCodexError("You have reached your usage limit.")).toContain("usage limit");
	expect(friendlyCodexError("This shared subscription cannot be used here.")).toContain(
		"cannot share",
	);
	expect(friendlyCodexError("Something else broke.")).toBe("Something else broke.");
});

describe("AGENT-16 Codex thread options", () => {
	function paramsOf(client: FakeClient, method: string): Record<string, unknown> {
		const request = client.requests.find((candidate) => candidate.method === method);
		expect(request).toBeDefined();
		return request?.params as Record<string, unknown>;
	}

	test("a thread starts with the default approval policy and full access", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		answerCompletedTurn(client);
		const session = makeSession(client);

		expect(
			await session.runTurn(
				turnInput("hello", { ...baseConfig, requireToolApproval: true }),
				callbacks(),
			),
		).toEqual({ kind: "success" });

		expect(paramsOf(client, "thread/start")).toMatchObject({
			approvalPolicy: "on-request",
			sandbox: "danger-full-access",
		});
		expect(paramsOf(client, "turn/start")).toMatchObject({ approvalPolicy: "on-request" });
		// The sandbox is a thread option; turn/start has no field with that name.
		expect(paramsOf(client, "turn/start")).not.toHaveProperty("sandbox");
	});

	test("the chosen personality reaches the thread and the turn", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		answerCompletedTurn(client);
		const session = makeSession(client);
		const chosen = { ...baseConfig, codexPersonality: "pragmatic" } as SessionConfig;

		expect(await session.runTurn(turnInput("hello", chosen), callbacks())).toEqual({
			kind: "success",
		});

		expect(paramsOf(client, "thread/start")).toMatchObject({ personality: "pragmatic" });
		expect(paramsOf(client, "turn/start")).toMatchObject({ personality: "pragmatic" });
	});

	test("Claude's ultracode effort is refused before Codex starts, and Codex levels pass as they are", async () => {
		const refusedClient = new FakeClient();
		const refused = await makeSession(refusedClient).runTurn(
			turnInput("hello", { ...baseConfig, effort: "ultracode" }),
			callbacks(),
		);

		expect(refused).toEqual({
			kind: "error",
			message: "Codex has no Ultracode effort level. Choose another effort level for this chat.",
			retryable: false,
		});
		expect(refusedClient.methods()).toEqual([]);

		const client = new FakeClient();
		answerThreadStart(client);
		answerCompletedTurn(client);
		const passed = await makeSession(client).runTurn(
			turnInput("hello", { ...baseConfig, effort: "ultra" }),
			callbacks(),
		);

		expect(passed).toEqual({ kind: "success" });
		expect(paramsOf(client, "turn/start")).toMatchObject({ effort: "ultra" });
	});

	test("the personality none and an explicit approval policy and sandbox reach thread/start", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		answerCompletedTurn(client);
		const chosen: SessionConfig = {
			...baseConfig,
			codexPersonality: "none",
			codexApprovalPolicy: "untrusted",
			codexSandboxMode: "workspace-write",
		};

		expect(await makeSession(client).runTurn(turnInput("hello", chosen), callbacks())).toEqual({
			kind: "success",
		});

		expect(paramsOf(client, "thread/start")).toMatchObject({
			personality: "none",
			approvalPolicy: "untrusted",
			sandbox: "workspace-write",
		});
	});

	test("a personality change re-opens the thread with the new tone", async () => {
		const client = new FakeClient();
		answerThreadStart(client);
		answerCompletedTurn(client);
		const session = makeSession(client);
		expect(await session.runTurn(turnInput(), callbacks())).toEqual({ kind: "success" });

		client.answers.set("thread/resume", () => ok({ thread: { id: "thread-1" }, model: "gpt-5" }));
		const changed = { ...baseConfig, codexPersonality: "friendly" } as SessionConfig;
		expect(await session.applyConfig(changed)).toBe("applied");
		expect(await session.runTurn(turnInput("again", changed), callbacks())).toEqual({
			kind: "success",
		});

		expect(client.methods()).toContain("thread/resume");
		expect(paramsOf(client, "thread/resume")).toMatchObject({
			threadId: "thread-1",
			personality: "friendly",
		});
	});
});
