/**
 * @feature AGENT-11 ACP client and runner: the session
 * Owns: tests for turns, output buffering, permission and elicitation answers, cancel, model
 * reconciliation, the resume warning, usage and the empty-answer error.
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
	permissionEnv: () => ({}),
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
	cancelled = false;
	closed = false;
	how: OpenedAcpSession["how"] = "new";
	configOptions: SessionConfigOption[] = [];
	promptCalls = 0;
	private resolvePrompt: ((result: Result<StopReason, AppError>) => void) | null = null;
	private closeListeners: ((reason: string) => void)[] = [];

	async connect(): Promise<Result<{ agentVersion: string | undefined }, AppError>> {
		return ok({ agentVersion: "1.2.3" });
	}

	async openSession(): Promise<Result<OpenedAcpSession, AppError>> {
		return ok({ acpSessionId: "acp-session-1", how: this.how, configOptions: this.configOptions });
	}

	prompt(): Promise<Result<StopReason, AppError>> {
		this.promptCalls += 1;
		return new Promise<Result<StopReason, AppError>>((resolve) => {
			this.resolvePrompt = resolve;
		});
	}

	finishPrompt(stopReason: StopReason = "end_turn"): void {
		this.resolvePrompt?.(ok(stopReason));
		this.resolvePrompt = null;
	}

	cancel(): void {
		this.cancelled = true;
	}

	async setConfigOption(_id: string, optionId: string, value: string | boolean) {
		this.setConfigCalls.push({ optionId, value });
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

	test("context usage comes from the last usage update", async () => {
		const session = makeSession(new FakeClient());

		session.handleUpdate(update({ sessionUpdate: "usage_update", used: 120, size: 8000 }));
		await waitFor(() => true, "nothing");
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(await session.contextUsage()).toEqual({ usedTokens: 120, windowTokens: 8000 });
	});
});
