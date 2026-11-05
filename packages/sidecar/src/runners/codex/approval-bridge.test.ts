/**
 * @feature AGENT-08 Codex: approvals, permission grants, MCP forms
 * Owns: tests for the five server-request handlers: the interaction each one opens, the reply it
 * sends back, the 300 s timeout of consent requests, and the logged outcome.
 * Test first: a command approval request opens a tool_approval interaction named Bash and an
 * "allow" answer returns { decision: "accept" }.
 */
import { describe, expect, test } from "bun:test";
import type { AgentMessage, Interaction, InteractionAnswer } from "@conducted/protocol";
import { CODEX_INTERACTION_TIMEOUT_MS } from "@conducted/protocol";
import type { AppError, Result } from "@conducted/shared";
import { createLogger, type LogRecord } from "../../logging/logger.ts";
import type { TurnCallbacks } from "../runner.ts";
import type { CodexAppServerClient, ServerRequestHandler } from "./app-server-client.ts";
import { CodexApprovalBridge } from "./approval-bridge.ts";
import type { CodexConsentOutcome } from "./approvals.ts";
import { CODEX_SERVER_REQUESTS } from "./protocol.ts";

class FakeClient implements CodexAppServerClient {
	private readonly handlers = new Map<string, ServerRequestHandler>();

	async connect(): Promise<Result<{ serverVersion: string }, AppError>> {
		return { ok: true, value: { serverVersion: "0.154.0" } };
	}

	async request<T>(): Promise<Result<T, AppError>> {
		return { ok: true, value: undefined as T };
	}

	onNotification(): () => void {
		return () => {};
	}

	onServerRequest(method: string, handler: ServerRequestHandler): void {
		this.handlers.set(method, handler);
	}

	onClose(): void {}

	async close(): Promise<void> {}

	hasHandler(method: string): boolean {
		return this.handlers.has(method);
	}

	invoke(method: string, params: unknown): Promise<unknown> {
		const handler = this.handlers.get(method);
		if (handler === undefined) throw new Error(`No handler for ${method}`);
		return handler(params);
	}
}

function callbacks(answer: (interaction: Interaction) => Promise<InteractionAnswer>) {
	const interactions: Interaction[] = [];
	const value: TurnCallbacks = {
		onMessage: () => {},
		requestInteraction: (interaction) => {
			interactions.push(interaction);
			return answer(interaction);
		},
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
	};
	return { value, interactions };
}

function logger(records: LogRecord[], onRecord?: (record: LogRecord) => void) {
	return createLogger({
		sink: (record) => {
			records.push(record);
			onRecord?.(record);
		},
		clock: { now: () => 0 },
		level: "info",
		scope: "test:codex-approvals",
	});
}

function makeBridge(options: {
	answer?: (interaction: Interaction) => Promise<InteractionAnswer>;
	callbacks?: () => TurnCallbacks | undefined;
	records?: LogRecord[];
	schedule?: (run: () => void, ms: number) => () => void;
	client?: FakeClient;
}) {
	const client = options.client ?? new FakeClient();
	const records = options.records ?? [];
	const outcomes: CodexConsentOutcome[] = [];
	const messages: AgentMessage[] = [];
	const current =
		options.callbacks ??
		(() => callbacks(options.answer ?? (async () => ({ kind: "withdrawn" }))).value);
	const bridge = new CodexApprovalBridge({
		client,
		callbacks: () => {
			const callbacksForTurn = current();
			if (callbacksForTurn === undefined) return undefined;
			return {
				...callbacksForTurn,
				onMessage: (message) => {
					messages.push(message);
					callbacksForTurn.onMessage(message);
				},
			};
		},
		logger: logger(records, (record) => {
			if (record.message !== "CodexMcpConsent: consent request ended") return;
			const outcome = record.data?.outcome;
			if (typeof outcome === "string") outcomes.push(outcome as CodexConsentOutcome);
		}),
		...(options.schedule === undefined ? {} : { scheduleTimeout: options.schedule }),
	});
	bridge.register();
	return { bridge, client, records, outcomes, messages };
}

const commandParams = {
	kind: "command",
	threadId: "thread-1",
	turnId: "turn-1",
	itemId: "item-1",
	reason: "Run the test suite",
	command: "pnpm test",
	cwd: "/workspace",
};

const permissionParams = {
	threadId: "thread-1",
	turnId: "turn-1",
	itemId: "item-2",
	environmentId: null,
	cwd: "/workspace",
	reason: "Needs the package cache",
	permissions: {
		network: { enabled: true },
		fileSystem: {
			read: ["/tmp"],
			write: null,
			entries: [{ path: { type: "path", path: "/tmp/cache" }, access: "write" }],
		},
	},
};

const formParams = {
	threadId: "thread-1",
	turnId: "turn-1",
	serverName: "linear",
	mode: "form",
	message: "Which branch?",
	requestedSchema: { type: "object", properties: {} },
};

describe("AGENT-08 approval bridge", () => {
	test("registers all five server requests", () => {
		const { client } = makeBridge({});
		for (const method of Object.values(CODEX_SERVER_REQUESTS)) {
			expect(client.hasHandler(method)).toBe(true);
		}
	});

	test("a command approval opens a Bash tool approval and an allow answer accepts", async () => {
		const { client } = makeBridge({
			answer: async () => ({ kind: "tool_approval", decision: "allow" }),
		});
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.commandApproval, commandParams);
		expect(reply).toEqual({ decision: "accept" });
	});

	test("a file-change approval opens an Edit tool approval", async () => {
		const { client } = makeBridge({
			answer: async () => ({ kind: "tool_approval", decision: "allow_edits_for_session" }),
		});
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.fileChangeApproval, {
			threadId: "thread-1",
			turnId: "turn-1",
			itemId: "item-3",
			reason: "Writes outside the workspace",
		});
		expect(reply).toEqual({ decision: "acceptForSession" });
	});

	test("the user input tool opens a question and returns answers keyed by question id", async () => {
		const { client, records } = makeBridge({
			answer: async () => ({
				kind: "question",
				answers: [["Postgres"], ["main"]],
			}),
		});
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.toolUserInput, {
			threadId: "thread-1",
			turnId: "turn-1",
			itemId: "item-4",
			isBlocking: true,
			autoResolutionMs: null,
			questions: [
				{
					id: "database",
					header: "Database",
					question: "Which database?",
					isOther: true,
					isSecret: false,
					options: [
						{ label: "Postgres", description: "Production" },
						{ label: "SQLite", description: "Local" },
					],
				},
				{
					id: "branch",
					header: "Branch",
					question: "Which branch?",
					isOther: true,
					isSecret: false,
					options: null,
				},
			],
		});
		expect(reply).toEqual({
			answers: {
				database: { answers: ["Postgres"] },
				branch: { answers: ["main"] },
			},
		});
		expect(records.some((record) => record.message.includes("CodexMcpConsent"))).toBe(false);
	});

	test("more than four questions open one card at a time", async () => {
		const made = callbacks(async (interaction) => {
			if (interaction.kind !== "question") throw new Error("expected a question");
			return {
				kind: "question",
				answers: interaction.questions.map((question) => [question.question]),
			};
		});
		const { client } = makeBridge({ callbacks: () => made.value });
		const questions = Array.from({ length: 6 }, (_, index) => ({
			id: `q${index + 1}`,
			header: `Question ${index + 1}`,
			question: `What is ${index + 1}?`,
			isOther: true,
			isSecret: false,
			options: null,
		}));
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.toolUserInput, { questions });
		expect(made.interactions).toHaveLength(2);
		expect(made.interactions[0]).toMatchObject({ kind: "question" });
		expect(reply).toEqual({
			answers: {
				q1: { answers: ["What is 1?"] },
				q2: { answers: ["What is 2?"] },
				q3: { answers: ["What is 3?"] },
				q4: { answers: ["What is 4?"] },
				q5: { answers: ["What is 5?"] },
				q6: { answers: ["What is 6?"] },
			},
		});
	});

	test("a question with more options than a card can show is refused, not trimmed", async () => {
		const { client, records } = makeBridge({
			answer: async () => ({ kind: "question", answers: [["a"]] }),
		});
		const pending = client.invoke(CODEX_SERVER_REQUESTS.toolUserInput, {
			questions: [
				{
					id: "pick",
					question: "Which one?",
					options: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }, { label: "e" }],
				},
			],
		});
		await expect(pending).rejects.toThrow(
			"A Codex question offers 5 options, but a card shows four at most.",
		);
		expect(
			records.some((record) => record.message.includes("cannot show a Codex question faithfully")),
		).toBe(true);
	});

	test("a withdrawn answer to user input fails the request instead of sending empty answers", async () => {
		const { client } = makeBridge({ answer: async () => ({ kind: "withdrawn" }) });
		const pending = client.invoke(CODEX_SERVER_REQUESTS.toolUserInput, {
			questions: [{ id: "pick", question: "Which one?" }],
		});
		await expect(pending).rejects.toThrow("The user did not answer the Codex question.");
	});

	test("with no callback a question fails instead of sending empty answers", async () => {
		const { client } = makeBridge({ callbacks: () => undefined });
		const pending = client.invoke(CODEX_SERVER_REQUESTS.toolUserInput, {
			questions: [{ id: "pick", question: "Which one?" }],
		});
		await expect(pending).rejects.toThrow("Codex asked a question, but no turn is active.");
	});

	test("an MCP form is shown as a card and accepted with its content", async () => {
		const { client } = makeBridge({
			answer: async () => ({
				kind: "mcp_form",
				action: "accept",
				content: { branch: "main" },
			}),
		});
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.mcpElicitation, formParams);
		expect(reply).toEqual({ action: "accept", content: { branch: "main" }, _meta: null });
	});

	test("an MCP form in url mode is declined and logged without a card", async () => {
		let asked = false;
		const { client, records, outcomes } = makeBridge({
			answer: async () => {
				asked = true;
				return { kind: "withdrawn" };
			},
		});
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.mcpElicitation, {
			threadId: "thread-1",
			turnId: null,
			serverName: "linear",
			mode: "url",
			message: "Sign in",
			url: "https://example.com/login",
			elicitationId: "elicit-1",
		});
		expect(asked).toBe(false);
		expect(reply).toEqual({ action: "decline", content: null, _meta: null });
		expect(records.some((record) => record.message.includes("CodexMcpConsent"))).toBe(true);
		expect(outcomes).toEqual(["user_declined"]);
	});

	test("a permission request opens a permission grant with paths, reason and network", async () => {
		let seen: Interaction | undefined;
		const { client } = makeBridge({
			answer: async (interaction) => {
				seen = interaction;
				return { kind: "permission_grant", granted: true, grantFor: "session" };
			},
		});
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.permissionsApproval, permissionParams);
		expect(seen).toEqual({
			kind: "permission_grant",
			description: "Needs the package cache",
			reason: "Needs the package cache",
			paths: [{ path: "/tmp/cache", pathKind: "path", access: "write" }],
			network: true,
		});
		expect(reply).toEqual({
			permissions: permissionParams.permissions,
			scope: "session",
		});
	});

	test("a declined permission returns an empty profile and logs the outcome", async () => {
		const { client, outcomes } = makeBridge({
			answer: async () => ({ kind: "permission_grant", granted: false }),
		});
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.permissionsApproval, permissionParams);
		expect(reply).toEqual({ permissions: {}, scope: "turn" });
		expect(outcomes).toEqual(["user_declined"]);
	});

	test("a declined form is emitted as a notice, not a chat error", async () => {
		const made = callbacks(async () => ({ kind: "mcp_form", action: "decline" }));
		const { client, messages } = makeBridge({ callbacks: () => made.value });
		await client.invoke(CODEX_SERVER_REQUESTS.mcpElicitation, formParams);
		expect(messages).toEqual([
			{
				agent: "codex",
				items: [{ kind: "notice", notice: "info", text: "[codex-mcp-consent] user_declined" }],
				raw: { event: "codex.mcpConsentOutcome", outcome: "user_declined" },
			},
		]);
	});

	test("with no callback a command approval declines", async () => {
		const { client } = makeBridge({ callbacks: () => undefined });
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.commandApproval, commandParams);
		expect(reply).toEqual({ decision: "decline" });
	});

	test("with no callback a permission approval fails", async () => {
		const { client, outcomes } = makeBridge({ callbacks: () => undefined });
		await expect(
			client.invoke(CODEX_SERVER_REQUESTS.permissionsApproval, permissionParams),
		).rejects.toThrow();
		expect(outcomes).toEqual(["interaction_unavailable"]);
	});

	test("a form whose app request rejects is cancelled as unavailable", async () => {
		const { client, outcomes } = makeBridge({
			answer: () => Promise.reject(new Error("the app is gone")),
		});
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.mcpElicitation, formParams);
		expect(reply).toEqual({ action: "cancel", content: null, _meta: null });
		expect(outcomes).toEqual(["interaction_unavailable"]);
	});

	test("a form with no callback is cancelled and logged", async () => {
		const { client, outcomes } = makeBridge({ callbacks: () => undefined });
		const reply = await client.invoke(CODEX_SERVER_REQUESTS.mcpElicitation, formParams);
		expect(reply).toEqual({ action: "cancel", content: null, _meta: null });
		expect(outcomes).toEqual(["interaction_unavailable"]);
	});

	test("a permission waits 300 s and then times out", async () => {
		let fire: (() => void) | undefined;
		let scheduledMs = 0;
		let cancelled = false;
		const { client, outcomes } = makeBridge({
			answer: () => new Promise<InteractionAnswer>(() => {}),
			schedule: (run, ms) => {
				scheduledMs = ms;
				fire = run;
				return () => {
					cancelled = true;
				};
			},
		});
		const pending = client.invoke(CODEX_SERVER_REQUESTS.permissionsApproval, permissionParams);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(scheduledMs).toBe(CODEX_INTERACTION_TIMEOUT_MS);
		expect(cancelled).toBe(false);
		fire?.();
		expect(await pending).toEqual({ permissions: {}, scope: "turn" });
		expect(outcomes).toEqual(["timeout"]);
	});

	test("an MCP form waits 300 s and then times out", async () => {
		let fire: (() => void) | undefined;
		const { client, outcomes } = makeBridge({
			answer: () => new Promise<InteractionAnswer>(() => {}),
			schedule: (run) => {
				fire = run;
				return () => {};
			},
		});
		const pending = client.invoke(CODEX_SERVER_REQUESTS.mcpElicitation, formParams);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		fire?.();
		expect(await pending).toEqual({ action: "cancel", content: null, _meta: null });
		expect(outcomes).toEqual(["timeout"]);
	});

	test("an answer cancels the timeout and is not logged as a timeout", async () => {
		let cancelled = false;
		const { client, outcomes } = makeBridge({
			answer: async () => ({ kind: "mcp_form", action: "decline" }),
			schedule: () => () => {
				cancelled = true;
			},
		});
		await client.invoke(CODEX_SERVER_REQUESTS.mcpElicitation, formParams);
		expect(cancelled).toBe(true);
		expect(outcomes).toEqual(["user_declined"]);
	});

	test("a command approval has no timeout", async () => {
		let scheduled = false;
		const { client } = makeBridge({
			answer: async () => ({ kind: "tool_approval", decision: "allow" }),
			schedule: () => {
				scheduled = true;
				return () => {};
			},
		});
		await client.invoke(CODEX_SERVER_REQUESTS.commandApproval, commandParams);
		expect(scheduled).toBe(false);
	});
});
