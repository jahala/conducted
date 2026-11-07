/**
 * The fake agent programs of the sidecar differential run (diff.ts). One file plays both agents:
 *
 * - `claude`: the Claude Code program as the Claude Agent SDK drives it, newline-delimited JSON on
 *   stdin and stdout (`--input-format stream-json --output-format stream-json`). It answers the
 *   SDK's control requests (`initialize` with commands, models and account; `interrupt`; anything
 *   else with an empty success), asks the SDK for tool permission with `can_use_tool`, and answers
 *   each user message with a scripted turn of `system`, `assistant`, `user` and `result` messages.
 * - `codex`: `codex app-server`, JSON-RPC 2.0 over stdio. It answers `initialize`, `thread/start`,
 *   `thread/resume`, `turn/start`, `turn/interrupt`, `model/list`, `account/read` and a few reads,
 *   streams the turn as `turn/started`, `item/*` and `turn/completed` notifications, and asks for
 *   command approval with `item/commandExecution/requestApproval`.
 *
 * Which turn it plays comes from a marker in the user's text, `[[sdiff:<scenario>]]`, so the same
 * program serves both sidecars without any setting of theirs. Every line in and out is appended to
 * the log file named by `SDIFF_AGENT_LOG`, which the wrapper script sets. Nothing here touches the
 * network or a real agent.
 *
 * The message shapes follow our own sidecar's test fixtures (runners/claude/translate.smoke.test.ts,
 * runners/codex/protocol.ts) and the SDK's published types.
 */
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

type Json = Record<string, unknown>;

const agent = process.argv[2] === "codex" ? "codex" : "claude";
const args = process.argv.slice(3);
const logPath = process.env.SDIFF_AGENT_LOG;

function log(entry: Json): void {
	if (logPath === undefined) return;
	appendFileSync(logPath, `${JSON.stringify({ agent, pid: process.pid, ...entry })}\n`);
}

function emit(message: Json): void {
	const line = JSON.stringify(message);
	log({ dir: "out", line });
	process.stdout.write(`${line}\n`);
}

function scenarioOf(text: string): string {
	return /\[\[sdiff:([a-z-]+)\]\]/.exec(text)?.[1] ?? "plain";
}

log({ dir: "start", args });

if (args.includes("--version") || args.includes("-v")) {
	process.stdout.write(agent === "claude" ? "2.1.999 (Claude Code)\n" : "codex-cli 0.164.0\n");
	process.exit(0);
}
if (agent === "claude" && args[0] === "auth" && args[1] === "status") {
	process.stdout.write(
		`${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "fake@example.invalid", subscriptionType: "max" })}\n`,
	);
	process.exit(0);
}
if (agent === "codex" && args[0] === "login" && args[1] === "status") {
	process.stdout.write("Logged in using ChatGPT\n");
	process.exit(0);
}

// ---------------------------------------------------------------- Claude

const CLAUDE_SESSION = "fake-claude-session";
const CLAUDE_MODEL = "claude-sonnet-5";

function claudeInit(): Json {
	return {
		commands: [
			{ name: "review", description: "Review the current change", argumentHint: "" },
			{ name: "fix-tests", description: "Fix failing tests", argumentHint: "<file>" },
		],
		agents: [],
		output_style: "default",
		available_output_styles: ["default"],
		models: [
			{ value: "default", displayName: "Default", description: "The recommended model" },
			{ value: "claude-opus-5", displayName: "Opus", description: "The largest model" },
		],
		account: { email: "fake@example.invalid", subscriptionType: "max", apiProvider: "firstParty" },
	};
}

const usage = {
	input_tokens: 10,
	output_tokens: 5,
	cache_read_input_tokens: 0,
	cache_creation_input_tokens: 0,
};

let uuidCounter = 0;
const uuid = () => `fake-uuid-${++uuidCounter}`;
let requestCounter = 0;

function systemInit(): Json {
	return {
		type: "system",
		subtype: "init",
		session_id: CLAUDE_SESSION,
		cwd: process.cwd(),
		tools: ["Bash", "Read", "Edit", "ExitPlanMode"],
		mcp_servers: [],
		model: CLAUDE_MODEL,
		permissionMode: "default",
		slash_commands: ["review", "fix-tests"],
		apiKeySource: "none",
		claude_code_version: "2.1.999",
		output_style: "default",
		agents: [],
		skills: [],
		plugins: [],
		uuid: uuid(),
	};
}

function assistant(content: Json[], extra: Json = {}): Json {
	return {
		type: "assistant",
		message: {
			id: `fake-msg-${uuidCounter + 1}`,
			type: "message",
			role: "assistant",
			model: CLAUDE_MODEL,
			content,
			stop_reason: null,
			usage,
		},
		parent_tool_use_id: null,
		session_id: CLAUDE_SESSION,
		uuid: uuid(),
		...extra,
	};
}

function toolResult(toolUseId: string, content: string, isError: boolean): Json {
	return {
		type: "user",
		message: {
			role: "user",
			content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }],
		},
		parent_tool_use_id: null,
		session_id: CLAUDE_SESSION,
		uuid: uuid(),
	};
}

/**
 * The uuid of the user message the current turn answers. A current CLI stamps it on the result as
 * `user_message_uuid` (and `user_message_uuids`); the "legacy" turn leaves it out, as older CLIs do.
 */
let answering: { uuid: string | undefined; legacy: boolean } = { uuid: undefined, legacy: false };

function result(subtype: string, isError: boolean, text: string): Json {
	const stamp =
		answering.uuid !== undefined && !answering.legacy
			? { user_message_uuid: answering.uuid, user_message_uuids: [answering.uuid] }
			: {};
	return {
		...stamp,
		type: "result",
		subtype,
		is_error: isError,
		duration_ms: 12,
		duration_api_ms: 10,
		num_turns: 1,
		result: text,
		stop_reason: isError ? null : "end_turn",
		session_id: CLAUDE_SESSION,
		total_cost_usd: 0.001,
		usage,
		modelUsage: {},
		permission_denials: [],
		uuid: uuid(),
	};
}

type ClaudeWake = { kind: "interrupt" } | { kind: "message" } | { kind: "timeout" };

function runClaude(): void {
	const pendingAnswers = new Map<string, (response: Json) => void>();
	const queue: { text: string; uuid: string | undefined }[] = [];
	let busy = false;
	let interrupted = false;
	let wake: ((why: ClaudeWake) => void) | undefined;

	const waitForWake = (ms: number) =>
		new Promise<ClaudeWake>((resolve) => {
			const timer = setTimeout(() => resolve({ kind: "timeout" }), ms);
			wake = (why) => {
				clearTimeout(timer);
				wake = undefined;
				resolve(why);
			};
		});

	const askPermission = (toolName: string, input: Json, toolUseId: string) =>
		new Promise<Json>((resolve) => {
			const requestId = `fake-req-${++requestCounter}`;
			pendingAnswers.set(requestId, resolve);
			emit({
				type: "control_request",
				request_id: requestId,
				request: {
					subtype: "can_use_tool",
					tool_name: toolName,
					input,
					tool_use_id: toolUseId,
					permission_suggestions: [],
				},
			});
		});

	const allowed = (answer: Json) => (answer.behavior ?? "deny") === "allow";

	async function turn(text: string, userUuid: string | undefined): Promise<void> {
		interrupted = false;
		const scenario = scenarioOf(text);
		answering = { uuid: userUuid, legacy: scenario === "legacy" };
		emit(systemInit());
		switch (scenario) {
			case "tools": {
				emit(
					assistant([
						{ type: "text", text: "Listing the files." },
						{ type: "tool_use", id: "toolu_fake_1", name: "Bash", input: { command: "ls" } },
					]),
				);
				emit(toolResult("toolu_fake_1", "README.md\nsrc", false));
				emit(assistant([{ type: "text", text: "There are two entries." }]));
				emit(result("success", false, "There are two entries."));
				return;
			}
			case "approval": {
				const input = { command: "touch approved.txt" };
				emit(assistant([{ type: "tool_use", id: "toolu_fake_2", name: "Bash", input }]));
				const answer = await askPermission("Bash", input, "toolu_fake_2");
				if (allowed(answer)) {
					emit(toolResult("toolu_fake_2", "", false));
					emit(assistant([{ type: "text", text: "Created the file." }]));
					emit(result("success", false, "Created the file."));
				} else {
					emit(toolResult("toolu_fake_2", String(answer.message ?? "denied"), true));
					emit(assistant([{ type: "text", text: "The command was not allowed." }]));
					emit(result("success", false, "The command was not allowed."));
				}
				return;
			}
			case "plan": {
				const input = { plan: "1. Read the code.\n2. Change it." };
				emit(assistant([{ type: "text", text: "Here is my plan." }]));
				emit(assistant([{ type: "tool_use", id: "toolu_fake_3", name: "ExitPlanMode", input }]));
				const answer = await askPermission("ExitPlanMode", input, "toolu_fake_3");
				if (allowed(answer)) {
					emit(toolResult("toolu_fake_3", "User has approved your plan.", false));
					emit(assistant([{ type: "text", text: "Starting on the plan." }]));
					emit(result("success", false, "Starting on the plan."));
				} else {
					emit(toolResult("toolu_fake_3", String(answer.message ?? "rejected"), true));
					emit(result("success", false, ""));
				}
				return;
			}
			case "error": {
				const text = "API Error: 500 Internal server error";
				emit(assistant([{ type: "text", text }], { error: "server_error" }));
				emit(result("success", true, text));
				return;
			}
			case "slow": {
				emit(assistant([{ type: "text", text: "Working on it." }]));
				const why = await waitForWake(4000);
				if (why.kind === "interrupt" || interrupted) {
					emit(result("error_during_execution", true, ""));
					return;
				}
				emit(assistant([{ type: "text", text: "Finished the first task." }]));
				emit(result("success", false, "Finished the first task."));
				return;
			}
			default: {
				emit(assistant([{ type: "text", text: "Hello from the fake agent." }]));
				emit(result("success", false, "Hello from the fake agent."));
			}
		}
	}

	async function drain(): Promise<void> {
		if (busy) return;
		busy = true;
		while (queue.length > 0) {
			const next = queue.shift() as { text: string; uuid: string | undefined };
			await turn(next.text, next.uuid);
		}
		busy = false;
	}

	const lines = createInterface({ input: process.stdin });
	lines.on("line", (line) => {
		log({ dir: "in", line });
		let message: Json;
		try {
			message = JSON.parse(line) as Json;
		} catch {
			return;
		}
		if (message.type === "control_request") {
			const request = (message.request ?? {}) as Json;
			const requestId = message.request_id;
			const reply = (response: Json) =>
				emit({
					type: "control_response",
					response: { subtype: "success", request_id: requestId, response },
				});
			if (request.subtype === "initialize") reply(claudeInit());
			else if (request.subtype === "interrupt") {
				interrupted = true;
				reply({});
				wake?.({ kind: "interrupt" });
			} else if (request.subtype === "mcp_status") reply({ mcpServers: [] });
			else reply({});
			return;
		}
		if (message.type === "control_response") {
			const response = (message.response ?? {}) as Json;
			const id = String(response.request_id ?? "");
			const answer = pendingAnswers.get(id);
			pendingAnswers.delete(id);
			answer?.((response.response ?? {}) as Json);
			return;
		}
		if (message.type === "user") {
			queue.push({
				text: textOf(message),
				uuid: typeof message.uuid === "string" ? message.uuid : undefined,
			});
			wake?.({ kind: "message" });
			void drain();
		}
	});
	lines.on("close", () => process.exit(0));
}

function textOf(message: Json): string {
	const inner = (message.message ?? {}) as Json;
	const content = inner.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.map((block) => (typeof block === "object" && block !== null ? (block as Json).text : ""))
			.filter((text): text is string => typeof text === "string")
			.join("\n");
	return "";
}

// ---------------------------------------------------------------- Codex

const CODEX_THREAD = "fake-thread-1";

function codexModels(): Json[] {
	return [
		{
			id: "gpt-5.5",
			model: "gpt-5.5",
			displayName: "GPT-5.5",
			description: "The fake default model",
			hidden: false,
			supportedReasoningEfforts: [
				{ reasoningEffort: "low", description: "Fast" },
				{ reasoningEffort: "medium", description: "Balanced" },
				{ reasoningEffort: "high", description: "Deep" },
			],
			defaultReasoningEffort: "medium",
			isDefault: true,
		},
		{
			id: "gpt-5.4",
			model: "gpt-5.4",
			displayName: "GPT-5.4",
			description: "A small fake model",
			hidden: false,
			supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }],
			defaultReasoningEffort: "low",
			isDefault: false,
		},
	];
}

const tokens = {
	totalTokens: 15,
	inputTokens: 10,
	cachedInputTokens: 0,
	cacheWriteInputTokens: 0,
	outputTokens: 5,
	reasoningOutputTokens: 0,
};

function runCodex(): void {
	let serverRequestId = 1000;
	let turnCounter = 0;
	let activeTurn: string | undefined;
	let interruptActive: (() => void) | undefined;
	const pending = new Map<number | string, (result: Json) => void>();

	const reply = (id: unknown, result: Json) => emit({ jsonrpc: "2.0", id, result });
	const fail = (id: unknown, code: number, message: string) =>
		emit({ jsonrpc: "2.0", id, error: { code, message } });
	const notify = (method: string, params: Json) => emit({ jsonrpc: "2.0", method, params });
	const ask = (method: string, params: Json) =>
		new Promise<Json>((resolve) => {
			const id = ++serverRequestId;
			pending.set(id, resolve);
			emit({ jsonrpc: "2.0", id, method, params });
		});

	const thread = (cwd: unknown) => ({
		id: CODEX_THREAD,
		preview: "",
		modelProvider: "openai",
		createdAt: 0,
		updatedAt: 0,
		path: null,
		cwd,
		cliVersion: "0.164.0",
		source: "appServer",
		gitInfo: null,
		turns: [],
	});

	async function playTurn(turnId: string, text: string, cwd: string): Promise<void> {
		const scenario = scenarioOf(text);
		const base = { threadId: CODEX_THREAD, turnId };
		notify("turn/started", {
			threadId: CODEX_THREAD,
			turn: { id: turnId, items: [], status: "inProgress", error: null },
		});
		const end = (status: string, error: Json | null = null) => {
			activeTurn = undefined;
			notify("thread/tokenUsage/updated", {
				...base,
				tokenUsage: { total: tokens, last: tokens, modelContextWindow: 200000 },
			});
			notify("turn/completed", {
				threadId: CODEX_THREAD,
				turn: { id: turnId, items: [], status, error },
			});
		};
		const message = (id: string, said: string) => {
			notify("item/started", { ...base, item: { type: "agentMessage", id, text: "" } });
			notify("item/agentMessage/delta", { ...base, itemId: id, delta: said });
			notify("item/completed", { ...base, item: { type: "agentMessage", id, text: said } });
		};
		if (scenario === "approval") {
			const item = {
				type: "commandExecution",
				id: "cmd-1",
				command: "touch approved.txt",
				cwd,
				processId: null,
				status: "inProgress",
				commandActions: [],
				aggregatedOutput: null,
				exitCode: null,
				durationMs: null,
			};
			notify("item/started", { ...base, item });
			const answer = await ask("item/commandExecution/requestApproval", {
				...base,
				itemId: "cmd-1",
				startedAtMs: Date.now(),
				approvalId: null,
				environmentId: null,
				reason: null,
				command: item.command,
				cwd,
			});
			const accepted =
				String(answer.decision ?? "") === "accept" ||
				String(answer.decision ?? "") === "acceptForSession";
			notify("item/completed", {
				...base,
				item: {
					...item,
					status: accepted ? "completed" : "declined",
					exitCode: accepted ? 0 : null,
					aggregatedOutput: "",
				},
			});
			message("msg-2", accepted ? "Created the file." : "The command was not allowed.");
			end("completed");
			return;
		}
		if (scenario === "slow") {
			message("msg-1", "Working on it.");
			const stopped = await new Promise<boolean>((resolve) => {
				const timer = setTimeout(() => resolve(false), 4000);
				interruptActive = () => {
					clearTimeout(timer);
					resolve(true);
				};
			});
			interruptActive = undefined;
			if (stopped) {
				end("interrupted");
				return;
			}
			message("msg-2", "Finished the first task.");
			end("completed");
			return;
		}
		if (scenario === "error") {
			notify("error", { ...base, error: { message: "fake upstream failure" }, willRetry: false });
			end("failed", { message: "fake upstream failure" });
			return;
		}
		message("msg-1", "Hello from the fake agent.");
		end("completed");
	}

	const lines = createInterface({ input: process.stdin });
	lines.on("line", (line) => {
		log({ dir: "in", line });
		let message: Json;
		try {
			message = JSON.parse(line) as Json;
		} catch {
			return;
		}
		const method = typeof message.method === "string" ? message.method : undefined;
		const id = message.id;
		if (method === undefined) {
			const answer = pending.get(id as number);
			pending.delete(id as number);
			answer?.((message.result ?? {}) as Json);
			return;
		}
		if (id === undefined || id === null) return;
		const params = (message.params ?? {}) as Json;
		switch (method) {
			case "initialize":
				reply(id, { userAgent: "fake-codex/0.164.0", codexHome: "/nonexistent/.codex" });
				return;
			case "thread/start":
			case "thread/resume": {
				const started = thread(params.cwd ?? null);
				reply(id, {
					thread: started,
					model: "gpt-5.5",
					modelProvider: "openai",
					cwd: params.cwd ?? null,
					approvalPolicy: params.approvalPolicy ?? "never",
					sandbox: { type: "dangerFullAccess" },
					reasoningEffort: null,
				});
				notify("thread/started", { thread: started });
				return;
			}
			case "turn/start": {
				const turnId = `fake-turn-${++turnCounter}`;
				activeTurn = turnId;
				reply(id, { turn: { id: turnId, items: [], status: "inProgress", error: null } });
				const input = Array.isArray(params.input) ? (params.input as Json[]) : [];
				const text = input
					.map((part) => (typeof part.text === "string" ? part.text : ""))
					.join("\n");
				void playTurn(turnId, text, String(params.cwd ?? process.cwd()));
				return;
			}
			case "turn/interrupt":
				reply(id, {});
				if (activeTurn !== undefined) interruptActive?.();
				return;
			case "model/list":
				reply(id, { data: codexModels(), nextCursor: null });
				return;
			case "account/read":
				reply(id, {
					account: { type: "chatgpt", email: "fake@example.invalid", planType: "pro" },
					requiresOpenaiAuth: true,
				});
				return;
			case "account/rateLimits/read":
				reply(id, { rateLimits: { primary: null, secondary: null } });
				return;
			case "experimentalFeature/enablement/set":
				reply(id, {});
				return;
			case "skills/list":
				reply(id, { data: [] });
				return;
			default:
				fail(id, -32601, `fake codex does not know ${method}`);
		}
	});
	lines.on("close", () => process.exit(0));
}

if (agent === "claude") runClaude();
else runCodex();
