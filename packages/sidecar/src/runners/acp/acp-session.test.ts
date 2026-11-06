/**
 * @feature AGENT-11 ACP client and runner: the session
 * Owns: tests for turns, output buffering, permission and elicitation answers, cancel, model
 * reconciliation, the resume warning, usage, the empty-answer error, and the chat options beyond
 * the model (AGENT-17).
 * Test first: two text chunks then end_turn flush one text message and resolve success.
 */
import { describe, expect, test } from "bun:test";
import type {
	CreateElicitationRequest,
	PermissionOption,
	RequestPermissionRequest,
	SessionConfigOption,
	SessionNotification,
	SessionUpdate,
	StopReason,
} from "@agentclientprotocol/sdk";
import type {
	AgentMessage,
	Interaction,
	InteractionAnswer,
	SessionConfig,
} from "@conducted/protocol";
import {
	type AppError,
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { createLogger, type Logger, type LogRecord } from "../../logging/logger.ts";
import { SteerNotSupportedError } from "../errors.ts";
import type { StartOptions, TurnCallbacks, TurnInput } from "../runner.ts";
import type { AcpClient, OpenedAcpSession } from "./acp-client.ts";
import { AcpSession } from "./acp-session.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";
import type { AcpTranslator } from "./translate.ts";

const adapter: AcpAdapter = {
	id: "opencode",
	displayName: "OpenCode",
	command: { executable: "opencode", args: ["acp"] },
	versionArgs: ["--version"],
	minimumVersion: "1.16.2",
	toolNameHints: {},
	waitForModelCatalogMs: 0,
	permissionEnv: () => ok({}),
};

const baseConfig: SessionConfig = {
	agent: "acp",
	acpAgent: "opencode",
	model: "",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

class FakeClient implements AcpClient {
	readonly setConfigCalls: { optionId: string; value: string | boolean }[] = [];
	readonly openSessionCalls: { resumeSessionId?: string }[] = [];
	cancelled = false;
	closed = false;
	how: OpenedAcpSession["how"] = "new";
	acpSessionId = "acp-session-1";
	configOptions: SessionConfigOption[] = [];
	/** Option ids whose session/set_config_option the agent answers with an error. */
	readonly refusedOptions = new Set<string>();
	promptCalls = 0;
	private readonly promptResolvers: ((result: Result<StopReason, AppError>) => void)[] = [];
	private closeListeners: ((reason: string) => void)[] = [];

	async connect(): Promise<Result<{ agentVersion: string | undefined }, AppError>> {
		return ok({ agentVersion: "1.2.3" });
	}

	async openSession(
		options: Parameters<AcpClient["openSession"]>[0],
	): Promise<Result<OpenedAcpSession, AppError>> {
		this.openSessionCalls.push(
			options.resumeSessionId === undefined ? {} : { resumeSessionId: options.resumeSessionId },
		);
		return ok({
			acpSessionId: this.acpSessionId,
			how: this.how,
			configOptions: this.configOptions,
		});
	}

	prompt(): Promise<Result<StopReason, AppError>> {
		this.promptCalls += 1;
		return new Promise<Result<StopReason, AppError>>((resolve) => {
			this.promptResolvers.push(resolve);
		});
	}

	finishPrompt(stopReason: StopReason = "end_turn", index = this.promptResolvers.length - 1): void {
		const resolve = this.promptResolvers[index];
		if (resolve === undefined) return;
		this.promptResolvers[index] = () => {};
		resolve(ok(stopReason));
	}

	failPrompt(error: AppError, index = this.promptResolvers.length - 1): void {
		const resolve = this.promptResolvers[index];
		if (resolve === undefined) return;
		this.promptResolvers[index] = () => {};
		resolve(err(error));
	}

	cancel(): void {
		this.cancelled = true;
	}

	async setConfigOption(
		_id: string,
		optionId: string,
		value: string | boolean,
	): Promise<Result<void, AppError>> {
		this.setConfigCalls.push({ optionId, value });
		if (this.refusedOptions.has(optionId)) {
			return err(appError("acp_request_failed", `The agent refused ${optionId}.`));
		}
		return ok(undefined);
	}

	async setMode(): Promise<Result<void, AppError>> {
		return ok(undefined);
	}

	onClose(listener: (reason: string) => void): void {
		this.closeListeners.push(listener);
	}

	async close(): Promise<void> {
		this.closed = true;
	}

	exit(reason: string): void {
		for (const listener of this.closeListeners) listener(reason);
	}
}

class FakeTranslator {
	private buffer = "";
	private thinking = "";

	push(update: SessionUpdate): AgentMessage[] {
		if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
			this.buffer += update.content.text;
		}
		if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
			this.thinking += update.content.text;
		}
		return [];
	}

	flush(): AgentMessage[] {
		const items: AgentMessage["items"] = [];
		if (this.buffer !== "") items.push({ kind: "text", text: this.buffer });
		if (this.thinking !== "")
			items.push({ kind: "thinking", text: this.thinking, summarized: false });
		this.buffer = "";
		this.thinking = "";
		return items.length === 0 ? [] : [{ agent: "acp", items }];
	}
}

class ThrowingTranslator {
	push(): AgentMessage[] {
		return notImplemented("AGENT-12");
	}

	flush(): AgentMessage[] {
		return notImplemented("AGENT-12");
	}
}

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

const turnInput = (): TurnInput => ({ text: "hello", attachmentPaths: [], config: baseConfig });

interface RecordedCallbacks extends TurnCallbacks {
	messages: AgentMessage[];
}

function callbacks(
	answer?: (interaction: Interaction) => Promise<InteractionAnswer>,
): RecordedCallbacks {
	const state: RecordedCallbacks = {
		messages: [],
		onMessage: (message) => state.messages.push(message),
		requestInteraction: answer ?? (async () => ({ kind: "withdrawn" })),
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
	};
	return state;
}

function logger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test:acp-session",
	});
}

function makeSession(
	client: FakeClient,
	options: {
		translator?: FakeTranslator;
		start?: StartOptions;
		configOptions?: SessionConfigOption[];
		adapter?: AcpAdapter;
		logger?: Logger;
	} = {},
): AcpSession {
	client.configOptions = options.configOptions ?? [];
	return new AcpSession(
		{
			adapter: options.adapter ?? adapter,
			connectClient: async () => client,
			translator: (options.translator ?? new FakeTranslator()) as unknown as AcpTranslator,
			mcpServers: [],
			logger: options.logger ?? logger(),
		},
		options.start ?? startOptions(),
	);
}

function update(change: SessionUpdate): SessionNotification {
	return { sessionId: "acp-session-1", update: change };
}

function textChunk(text: string): SessionNotification {
	return update({
		sessionUpdate: "agent_message_chunk",
		content: { type: "text", text },
	});
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + 2000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

const option = (
	optionId: string,
	name: string,
	kind: PermissionOption["kind"],
): PermissionOption => ({
	optionId,
	name,
	kind,
});

const permissionRequest = (options: PermissionOption[]): RequestPermissionRequest => ({
	sessionId: "acp-session-1",
	toolCall: { toolCallId: "tool-1", title: "Run the tests", name: "bash", rawInput: { cmd: "ls" } },
	options,
});

describe("AGENT-11 ACP session", () => {
	test("two text chunks then end_turn flush one text message and settle success", async () => {
		const client = new FakeClient();
		const session = makeSession(client);
		const recorded = callbacks();

		const outcome = session.runTurn(turnInput(), recorded);
		await waitFor(() => client.promptCalls === 1, "the prompt");
		session.handleUpdate(textChunk("a"));
		session.handleUpdate(textChunk("b"));
		client.finishPrompt("end_turn");

		expect(await outcome).toEqual({ kind: "success" });
		const notices = recorded.messages.flatMap((message) =>
			message.items.filter((item) => item.kind === "notice"),
		);
		expect(
			notices.some((item) => item.kind === "notice" && item.notice === "session_started"),
		).toBe(true);
		const texts = recorded.messages.flatMap((message) =>
			message.items.filter((item) => item.kind === "text"),
		);
		expect(texts).toEqual([{ kind: "text", text: "ab" }]);
	});

	test("a second turn started while the first is starting is refused", async () => {
		const client = new FakeClient();
		const session = makeSession(client);

		const first = session.runTurn(turnInput(), callbacks());
		const second = await session.runTurn(turnInput(), callbacks());

		expect(second.kind).toBe("error");
		if (second.kind === "error") expect(second.message).toContain("already running");
		await waitFor(() => client.promptCalls === 1, "the first prompt");
		session.handleUpdate(textChunk("one"));
		client.finishPrompt("end_turn");
		expect(await first).toEqual({ kind: "success" });
	});

	test("a late reply to a cancelled prompt does not settle the new turn", async () => {
		const client = new FakeClient();
		const session = makeSession(client);

		const first = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the first prompt");
		await session.cancel();
		expect(await first).toEqual({ kind: "cancelled" });

		const second = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 2, "the second prompt");
		client.finishPrompt("cancelled", 0);
		await new Promise((resolve) => setTimeout(resolve, 5));
		const stillPending = await Promise.race([
			second.then(() => "settled" as const),
			new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 5)),
		]);
		expect(stillPending).toBe("pending");

		session.handleUpdate(textChunk("new turn"));
		client.finishPrompt("end_turn", 1);
		expect(await second).toEqual({ kind: "success" });
	});

	test("a child that dies mid-turn is resumed by the next turn", async () => {
		const client = new FakeClient();
		const session = makeSession(client);

		const first = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the first prompt");
		client.exit("The agent stopped");
		const failed = await first;
		expect(failed.kind).toBe("error");
		if (failed.kind === "error") expect(failed.message).toContain("The agent stopped");

		client.how = "resumed";
		const second = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 2, "the second prompt");

		expect(client.openSessionCalls[1]).toEqual({ resumeSessionId: "acp-session-1" });
		session.handleUpdate(textChunk("again"));
		client.finishPrompt("end_turn", 1);
		expect(await second).toEqual({ kind: "success" });
	});

	test("a fresh chat whose child dies between turns warns that history was not restored", async () => {
		const client = new FakeClient();
		const session = makeSession(client);

		const first = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the first prompt");
		session.handleUpdate(textChunk("first"));
		client.finishPrompt("end_turn", 0);
		expect(await first).toEqual({ kind: "success" });

		client.exit("The agent stopped");
		await new Promise((resolve) => setTimeout(resolve, 5));
		client.how = "new";
		const recorded = callbacks();
		const second = session.runTurn(turnInput(), recorded);
		await waitFor(() => client.promptCalls === 2, "the second prompt");

		expect(client.openSessionCalls[1]).toEqual({ resumeSessionId: "acp-session-1" });
		const notices = recorded.messages.flatMap((message) =>
			message.items.filter((item) => item.kind === "notice"),
		);
		expect(
			notices.some(
				(item) => item.kind === "notice" && item.text.includes("history was not restored"),
			),
		).toBe(true);
		client.finishPrompt("cancelled", 1);
		expect(await second).toEqual({ kind: "cancelled" });
	});

	test("a config change during a turn is applied before the next prompt", async () => {
		const client = new FakeClient();
		const session = makeSession(client, {
			configOptions: [
				{
					type: "select",
					id: "model",
					name: "Model",
					category: "model",
					currentValue: "one",
					options: [
						{ value: "one", name: "One" },
						{ value: "two", name: "Two" },
					],
				},
			],
		});
		const first = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the first prompt");

		expect(await session.applyConfig({ ...baseConfig, model: "two" })).toBe("applied");
		expect(client.setConfigCalls).toEqual([]);

		session.handleUpdate(textChunk("first"));
		client.finishPrompt("end_turn", 0);
		await first;

		const second = session.runTurn(
			{ ...turnInput(), config: { ...baseConfig, model: "two" } },
			callbacks(),
		);
		await waitFor(() => client.promptCalls === 2, "the second prompt");
		expect(client.setConfigCalls).toEqual([{ optionId: "model", value: "two" }]);
		session.handleUpdate(textChunk("second"));
		client.finishPrompt("end_turn", 1);
		await second;
	});

	test("a translation placeholder surfaces as an error instead of an empty turn", async () => {
		const client = new FakeClient();
		const session = new AcpSession(
			{
				adapter,
				connectClient: async () => client,
				translator: new ThrowingTranslator() as unknown as AcpTranslator,
				mcpServers: [],
				logger: createLogger({
					sink: () => {},
					clock: { now: () => 0 },
					level: "debug",
					scope: "test:acp-session",
				}),
			},
			startOptions(),
		);
		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the prompt");

		session.handleUpdate(textChunk("x"));
		const failed = await outcome;
		expect(failed.kind).toBe("error");
		if (failed.kind === "error") expect(failed.message).toContain("Not implemented: AGENT-12");

		const later = await session.runTurn(turnInput(), callbacks());
		expect(later.kind).toBe("error");
		if (later.kind === "error") expect(later.message).toContain("output error");
		await session.dispose();
	});

	test("a url-mode elicitation is declined and a form with no fields is declined", async () => {
		const client = new FakeClient();
		const session = makeSession(client, {
			start: { ...startOptions(), config: { ...baseConfig, requireToolApproval: true } },
		});
		const outcome = session.runTurn(
			{ ...turnInput(), config: { ...baseConfig, requireToolApproval: true } },
			callbacks(),
		);
		await waitFor(() => client.promptCalls === 1, "the prompt");

		const url = {
			mode: "url",
			sessionId: "acp-session-1",
			message: "Open this",
			url: "https://example.com",
			elicitationId: "one",
		} as unknown as CreateElicitationRequest;
		expect(await session.requestElicitation(url)).toEqual({ action: "decline" });

		const empty = {
			mode: "form",
			sessionId: "acp-session-1",
			message: "Nothing to fill",
			requestedSchema: { type: "object", properties: {} },
		} as unknown as CreateElicitationRequest;
		expect(await session.requestElicitation(empty)).toEqual({ action: "decline" });

		client.finishPrompt("cancelled");
		await outcome;
	});

	test("an elicitation form shows its message, applies defaults and declines bad answers", async () => {
		const client = new FakeClient();
		const session = makeSession(client, {
			start: { ...startOptions(), config: { ...baseConfig, requireToolApproval: true } },
		});
		const seen: Interaction[] = [];
		let answers: string[][] = [];
		const recorded = callbacks(async (interaction) => {
			seen.push(interaction);
			return { kind: "question", answers };
		});
		const outcome = session.runTurn(
			{ ...turnInput(), config: { ...baseConfig, requireToolApproval: true } },
			recorded,
		);
		await waitFor(() => client.promptCalls === 1, "the prompt");
		const form = (properties: Record<string, unknown>, required: string[]) =>
			({
				mode: "form",
				sessionId: "acp-session-1",
				message: "Tell us who you are",
				requestedSchema: { type: "object", properties, required },
			}) as unknown as CreateElicitationRequest;
		const name = { type: "string", title: "Your name" };
		const count = { type: "integer", title: "How many" };

		answers = [[], []];
		expect(
			await session.requestElicitation(form({ name: { ...name, default: "guest" }, count }, [])),
		).toEqual({ action: "accept", content: { name: "guest" } });

		const shown = seen[seen.length - 1];
		expect(shown?.kind === "question" ? shown.questions[0]?.question : "").toContain(
			"Tell us who you are",
		);

		answers = [[]];
		expect(await session.requestElicitation(form({ name }, ["name"]))).toEqual({
			action: "decline",
		});

		answers = [["not a number"]];
		expect(await session.requestElicitation(form({ count }, ["count"]))).toEqual({
			action: "decline",
		});

		answers = [["maybe"]];
		expect(
			await session.requestElicitation(
				form({ agree: { type: "boolean", title: "Agree" } }, ["agree"]),
			),
		).toEqual({ action: "decline" });

		client.finishPrompt("cancelled");
		await outcome;
	});

	test("a turn with no visible content is an error naming the adapter and its command", async () => {
		const client = new FakeClient();
		const session = makeSession(client);

		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the prompt");
		client.finishPrompt("end_turn");

		const result = await outcome;
		expect(result.kind).toBe("error");
		if (result.kind !== "error") return;
		expect(result.message).toContain("OpenCode");
		expect(result.message).toContain("opencode");
	});

	test("a bare internal error is replaced by the agent's last output", async () => {
		const client = new FakeClient();
		const session = makeSession(client);
		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the prompt");

		session.handleUpdate(textChunk("the provider said no"));
		client.failPrompt(appError("acp_internal", "Internal error"));

		expect(await outcome).toEqual({
			kind: "error",
			message: "the provider said no",
			retryable: false,
		});
	});

	test("steering is refused with the typed error", async () => {
		const session = makeSession(new FakeClient());

		await expect(session.steer(turnInput())).rejects.toBeInstanceOf(SteerNotSupportedError);
	});

	test("cancel resolves an open permission request as cancelled", async () => {
		const client = new FakeClient();
		const session = makeSession(client, {
			start: { ...startOptions(), config: { ...baseConfig, requireToolApproval: true } },
		});
		const pending = callbacks(() => new Promise<InteractionAnswer>(() => {}));
		const outcome = session.runTurn(
			{ ...turnInput(), config: { ...baseConfig, requireToolApproval: true } },
			pending,
		);
		await waitFor(() => client.promptCalls === 1, "the prompt");

		const answer = session.requestPermission(
			permissionRequest([
				option("allow", "Allow", "allow_once"),
				option("reject", "Reject", "reject_once"),
			]),
		);
		await session.cancel();

		expect(await answer).toEqual({ outcome: { outcome: "cancelled" } });
		expect(await outcome).toEqual({ kind: "cancelled" });
		expect(client.cancelled).toBe(true);
	});

	test("two allow options and no reject option is shown as a question", async () => {
		const client = new FakeClient();
		const session = makeSession(client, {
			start: { ...startOptions(), config: { ...baseConfig, requireToolApproval: true } },
		});
		const seen: Interaction[] = [];
		const recorded = callbacks(async (interaction) => {
			seen.push(interaction);
			return { kind: "question", answers: [["Second"]] };
		});
		const outcome = session.runTurn(
			{ ...turnInput(), config: { ...baseConfig, requireToolApproval: true } },
			recorded,
		);
		await waitFor(() => client.promptCalls === 1, "the prompt");

		const answer = await session.requestPermission(
			permissionRequest([
				option("first", "First", "allow_once"),
				option("second", "Second", "allow_always"),
			]),
		);

		expect(seen[0]?.kind).toBe("question");
		expect(answer).toEqual({ outcome: { outcome: "selected", optionId: "second" } });
		client.finishPrompt("end_turn");
		await outcome;
	});

	test("with approvals off the client answers allow_once itself", async () => {
		const client = new FakeClient();
		const session = makeSession(client);
		const recorded = callbacks();
		const outcome = session.runTurn(turnInput(), recorded);
		await waitFor(() => client.promptCalls === 1, "the prompt");

		const answer = await session.requestPermission(
			permissionRequest([option("allow", "Allow", "allow_once")]),
		);

		expect(answer).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
		session.handleUpdate(textChunk("done"));
		client.finishPrompt("end_turn");
		await outcome;
	});

	test("a form elicitation becomes a question and returns the typed values", async () => {
		const client = new FakeClient();
		const session = makeSession(client, {
			start: { ...startOptions(), config: { ...baseConfig, requireToolApproval: true } },
		});
		const recorded = callbacks(async () => ({
			kind: "question",
			answers: [["hello"], ["yes"]],
		}));
		const outcome = session.runTurn(
			{ ...turnInput(), config: { ...baseConfig, requireToolApproval: true } },
			recorded,
		);
		await waitFor(() => client.promptCalls === 1, "the prompt");
		const request: CreateElicitationRequest = {
			mode: "form",
			sessionId: "acp-session-1",
			message: "Fill this in",
			requestedSchema: {
				type: "object",
				properties: {
					name: { type: "string", title: "Your name" },
					agree: { type: "boolean", title: "Agree" },
				},
			},
		};

		const answer = await session.requestElicitation(request);

		expect(answer).toEqual({
			action: "accept",
			content: { name: "hello", agree: true },
		});
		client.finishPrompt("end_turn");
		await outcome;
	});

	test("a model change goes through set_config_option before the prompt", async () => {
		const client = new FakeClient();
		const session = makeSession(client, {
			configOptions: [
				{
					type: "select",
					id: "model",
					name: "Model",
					category: "model",
					currentValue: "one",
					options: [
						{ value: "one", name: "One" },
						{ value: "two", name: "Two" },
					],
				},
			],
		});
		const config = { ...baseConfig, model: "two" };

		const outcome = session.runTurn({ ...turnInput(), config }, callbacks());
		await waitFor(() => client.promptCalls === 1, "the prompt");
		client.finishPrompt("end_turn");

		expect(client.setConfigCalls).toEqual([{ optionId: "model", value: "two" }]);
		await outcome;
	});

	test("a model list that never loads fails with the sign-in hint", async () => {
		const client = new FakeClient();
		const session = makeSession(client, {
			adapter: { ...adapter, waitForModelCatalogMs: 5 },
		});

		const outcome = await session.runTurn(
			{ ...turnInput(), config: { ...baseConfig, model: "two" } },
			callbacks(),
		);

		expect(outcome.kind).toBe("error");
		if (outcome.kind !== "error") return;
		expect(outcome.message).toContain("did not load its model list");
		expect(outcome.message).toContain("sign-in");
		expect(client.promptCalls).toBe(0);
	});

	test("a resume that fell back to a new session warns that history was not restored", async () => {
		const client = new FakeClient();
		client.how = "new";
		const session = makeSession(client, { start: startOptions("old-session") });
		const recorded = callbacks();

		const outcome = session.runTurn(turnInput(), recorded);
		await waitFor(() => client.promptCalls === 1, "the prompt");
		client.finishPrompt("cancelled");
		await outcome;

		const notices = recorded.messages.flatMap((message) =>
			message.items.filter((item) => item.kind === "notice"),
		);
		expect(
			notices.some(
				(item) => item.kind === "notice" && item.text.includes("history was not restored"),
			),
		).toBe(true);
	});

	test("an app-tool change during a running chat keeps the open tools and logs why", async () => {
		const records: LogRecord[] = [];
		const client = new FakeClient();
		const session = makeSession(client, {
			logger: createLogger({
				sink: (record) => records.push(record),
				clock: { now: () => 0 },
				level: "debug",
				scope: "test:acp-session",
			}),
		});
		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the prompt");

		const applied = await session.applyConfig({
			...baseConfig,
			appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
		});

		expect(applied).toBe("applied");
		expect(
			records.some((record) => record.message.includes("keeps the app tools it opened with")),
		).toBe(true);
		client.finishPrompt("cancelled");
		await outcome;
	});

	test("a change of extra folders needs a restart", async () => {
		const session = makeSession(new FakeClient());

		expect(
			await session.applyConfig({ ...baseConfig, additionalDirectories: ["/another/folder"] }),
		).toBe("restart");
	});

	test("AGENT-17 lists the chat options beyond the model and applies the saved choices", async () => {
		const client = new FakeClient();
		client.configOptions = [
			{
				type: "select",
				id: "model",
				name: "Model",
				category: "model",
				currentValue: "one",
				options: [
					{ value: "one", name: "One" },
					{ value: "two", name: "Two" },
				],
			},
			{
				type: "select",
				id: "thought_level",
				name: "Thought level",
				category: "thought_level",
				currentValue: "medium",
				options: [
					{ value: "low", name: "Low" },
					{ value: "medium", name: "Medium" },
					{ value: "high", name: "High" },
				],
			},
			{ type: "boolean", id: "web_search", name: "Web search", currentValue: false },
		];
		const session = makeSession(client, { configOptions: client.configOptions });
		const config: SessionConfig = {
			...baseConfig,
			model: "two",
			acpConfig: { thought_level: "high", web_search: true },
		};

		const listed = await session.listAcpConfigOptions(config);

		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.value.map((option) => option.id)).toEqual(["thought_level", "web_search"]);
		expect(listed.value).toEqual([
			{
				id: "thought_level",
				name: "Thought level",
				category: "thought_level",
				value: {
					kind: "select",
					current: "high",
					choices: [
						{ value: "low", name: "Low" },
						{ value: "medium", name: "Medium" },
						{ value: "high", name: "High" },
					],
				},
			},
			{ id: "web_search", name: "Web search", value: { kind: "switch", current: true } },
		]);
		expect(client.setConfigCalls).toEqual([
			{ optionId: "model", value: "two" },
			{ optionId: "thought_level", value: "high" },
			{ optionId: "web_search", value: true },
		]);
	});

	test("AGENT-17 a saved option the agent refuses is skipped, keeps the agent's value, and the chat opens", async () => {
		const client = new FakeClient();
		client.configOptions = [
			{
				type: "select",
				id: "thought_level",
				name: "Thought level",
				currentValue: "medium",
				options: [
					{ value: "medium", name: "Medium" },
					{ value: "high", name: "High" },
				],
			},
			{ type: "boolean", id: "web_search", name: "Web search", currentValue: false },
		];
		client.refusedOptions.add("thought_level");
		const session = makeSession(client, { configOptions: client.configOptions });
		const config: SessionConfig = {
			...baseConfig,
			acpConfig: { thought_level: "high", web_search: true },
		};

		const listed = await session.listAcpConfigOptions(config);

		expect(listed.ok).toBe(true);
		if (!listed.ok) return;
		expect(listed.value.map((option) => [option.id, option.value.current])).toEqual([
			["thought_level", "medium"],
			["web_search", true],
		]);
		expect(client.setConfigCalls).toEqual([
			{ optionId: "thought_level", value: "high" },
			{ optionId: "web_search", value: true },
		]);
	});

	test("AGENT-17 a refused saved option does not fail the turn", async () => {
		const client = new FakeClient();
		client.configOptions = [
			{
				type: "select",
				id: "thought_level",
				name: "Thought level",
				currentValue: "medium",
				options: [
					{ value: "medium", name: "Medium" },
					{ value: "high", name: "High" },
				],
			},
		];
		client.refusedOptions.add("thought_level");
		const session = makeSession(client, { configOptions: client.configOptions });

		const outcome = session.runTurn(
			{
				text: "hello",
				attachmentPaths: [],
				config: { ...baseConfig, acpConfig: { thought_level: "high" } },
			},
			callbacks(),
		);
		await waitFor(() => client.promptCalls === 1, "the prompt");
		session.handleUpdate(textChunk("done"));
		client.finishPrompt("end_turn");

		expect(await outcome).toEqual({ kind: "success" });
		expect(client.setConfigCalls).toEqual([{ optionId: "thought_level", value: "high" }]);
	});

	test("AGENT-17 sets one option and returns every option", async () => {
		const client = new FakeClient();
		client.configOptions = [
			{
				type: "select",
				id: "thought_level",
				name: "Thought level",
				currentValue: "medium",
				options: [
					{ value: "low", name: "Low" },
					{ value: "medium", name: "Medium" },
					{ value: "high", name: "High" },
				],
			},
		];
		const session = makeSession(client, { configOptions: client.configOptions });

		const changed = await session.setAcpConfigOption("thought_level", "high", baseConfig);

		expect(changed.ok).toBe(true);
		if (!changed.ok) return;
		expect(client.setConfigCalls).toEqual([{ optionId: "thought_level", value: "high" }]);
		expect(changed.value[0]?.value).toEqual({
			kind: "select",
			current: "high",
			choices: [
				{ value: "low", name: "Low" },
				{ value: "medium", name: "Medium" },
				{ value: "high", name: "High" },
			],
		});
	});

	test("AGENT-17 refuses an unknown option, a value it does not offer, and the model", async () => {
		const client = new FakeClient();
		client.configOptions = [
			{
				type: "select",
				id: "model",
				name: "Model",
				category: "model",
				currentValue: "one",
				options: [
					{ value: "one", name: "One" },
					{ value: "two", name: "Two" },
				],
			},
			{
				type: "select",
				id: "thought_level",
				name: "Thought level",
				currentValue: "medium",
				options: [
					{ value: "low", name: "Low" },
					{ value: "medium", name: "Medium" },
				],
			},
			{ type: "boolean", id: "web_search", name: "Web search", currentValue: false },
		];
		const session = makeSession(client, { configOptions: client.configOptions });

		const unknown = await session.setAcpConfigOption("ghost", "x", baseConfig);
		const invalid = await session.setAcpConfigOption("thought_level", "high", baseConfig);
		const wrongType = await session.setAcpConfigOption("web_search", "yes", baseConfig);
		const model = await session.setAcpConfigOption("model", "two", baseConfig);

		expect(unknown.ok).toBe(false);
		expect(invalid.ok).toBe(false);
		expect(wrongType.ok).toBe(false);
		expect(model.ok).toBe(false);
		expect(client.setConfigCalls).toEqual([]);
	});

	test("AGENT-17 refuses a change while a turn runs", async () => {
		const client = new FakeClient();
		const session = makeSession(client);
		const running = session.runTurn(turnInput(), callbacks());
		await waitFor(() => client.promptCalls === 1, "the prompt");

		const changed = await session.setAcpConfigOption("thought_level", "high", baseConfig);

		expect(changed.ok).toBe(false);
		if (!changed.ok) expect(changed.error.code).toBe("acp_turn_running");
		client.finishPrompt("cancelled");
		await running;
	});

	test("context usage comes from the last usage update", async () => {
		const session = makeSession(new FakeClient());

		session.handleUpdate(update({ sessionUpdate: "usage_update", used: 120, size: 8000 }));
		await waitFor(() => true, "nothing");
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(await session.contextUsage()).toEqual({ usedTokens: 120, windowTokens: 8000 });
	});
});
