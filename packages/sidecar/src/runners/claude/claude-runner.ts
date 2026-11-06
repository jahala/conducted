/**
 * @feature AGENT-02 Claude: Agent SDK in streaming-input mode, resume, fork
 * Owns: the Runner for Claude Code: finding the program, its version and sign-in state, starting a
 * ClaudeSession, listing models, slash commands and MCP servers.
 * Behaviour: research/conductor/claude-runner.md sections 1 and 7 and decision 7 in
 * docs/plans/scaffold.md. Provider routing and the `claude auth status --json` call belong to
 * SIDE-21 (runners/launch-env.ts) and SIDE-15 (models/agent-detection.ts).
 * Must handle:
 *  - detect(): `claude` not on PATH gives null; `claude --version` that hangs gives an error value
 *    after 5 s, reported as installed without a version by the detector
 *  - start() with a missing workspace folder: an error that names the folder
 *  - start() runs the program the chat's launch names (SIDE-21, `findAgentProgram`): the user's
 *    path, else the copy on the login-shell PATH; a user path that cannot run is an error that
 *    names it; a `.js` path starts through node
 *  - the listing calls run the program and environment of their `ListingContext` (the app's
 *    launch), by the same rule as start()
 *  - listModels(): from supportedModels() of a throwaway metadata query; efforts from
 *    supportedEffortLevels, fast mode from supportsFastMode; the default effort is the middle of
 *    the list when the SDK gives none
 *  - listSlashCommands(): from supportedCommands() of a throwaway metadata query; the throwaway
 *    query is always ended, even on error; a command the SDK marks builtin is ours, one named
 *    "mcp__…" is MCP, a namespaced one is a plugin command, and any other is a project command
 *    (the SDK does not tell project, user and plugin commands apart)
 *  - listMcpServers(): from mcpServerStatus() of the same throwaway query; its scope, transport,
 *    error text and tool names are kept
 *  - capabilities are fixed: steer, interrupt, resumeAt, liveConfig, slashCommands, mcpServers and
 *    contextUsage are all supported
 * Test first: detect() with a findExecutable that returns null resolves to null without probing.
 */
import type {
	McpServerStatusConfig,
	Query,
	SDKUserMessage,
	McpServerStatus as SdkMcpServerStatus,
	ModelInfo as SdkModelInfo,
	SlashCommand as SdkSlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type { Effort, ModelInfo } from "@conducted/protocol";
import { appError } from "@conducted/shared";
import { parseVersion, VERSION_PROBE_TIMEOUT_MS } from "../../models/agent-detection.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import { type AgentProgram, findAgentProgram } from "../launch-env.ts";
import type {
	AgentSession,
	ListingContext,
	McpServerView,
	Runner,
	RunnerCapabilities,
	RunnerSlashCommand,
	StartOptions,
} from "../runner.ts";
import { ClaudeSession, type ClaudeSessionDeps } from "./claude-session.ts";
import { CLAUDE_SETTING_SOURCES } from "./constants.ts";
import type { ClaudeTranslator } from "./translate.ts";

/** Builds the translator a new ClaudeSession owns, so two chats never share its state. */
export type ClaudeTranslatorFactory = () => ClaudeTranslator;

export type ClaudeRunnerDeps = RunnerCommonDeps &
	Omit<
		Pick<
			ClaudeSessionDeps,
			| "query"
			| "translator"
			| "appTools"
			| "hasTranscript"
			| "readUserMessageText"
			| "skillPluginDir"
			| "realPath"
			| "newUuid"
			| "scheduler"
			| "createCanUseTool"
			| "createMcpServers"
		>,
		"translator"
	> & {
		/**
		 * A translator for one chat, or a template whose fresh() builds each chat's translator.
		 * The composition root passes an instance or a factory; either way every session gets its
		 * own state.
		 */
		translator: ClaudeTranslator | ClaudeTranslatorFactory;
	};

export class ClaudeRunner implements Runner {
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

	constructor(protected readonly deps: ClaudeRunnerDeps) {}

	async detect(
		env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		const path = await this.deps.findExecutable("claude", env);
		if (path === null) return null;
		const probed = await this.deps.probe(path, ["--version"], {
			env,
			timeoutMs: VERSION_PROBE_TIMEOUT_MS,
		});
		if (!probed.ok) {
			// Reported as installed but without a version, as the detector expects.
			this.deps.logger.warn("Could not read the Claude version", {
				path,
				code: probed.error.code,
			});
			return { path, version: "" };
		}
		return {
			path,
			version: parseVersion(probed.value.stdout || probed.value.stderr) ?? "",
		};
	}

	async start(options: StartOptions): Promise<AgentSession> {
		const requested = options.workspace.workspacePath;
		const resolved = await this.deps.realPath(requested);
		if (resolved === null) {
			throw appError("workspace_missing", `Workspace directory missing: ${requested}`);
		}
		if (resolved !== requested) {
			// Claude names its transcript folder from the real path, so resume must use it too.
			this.deps.logger.warn("Workspace path resolves through a symlink", {
				path: requested,
				realPath: resolved,
			});
		}
		const program = await findAgentProgram({
			agent: "claude",
			name: "claude",
			executablePath: options.executablePath,
			env: options.env,
			findExecutable: this.deps.findExecutable,
		});
		if (!program.ok) throw program.error;
		const start =
			resolved === requested
				? options
				: { ...options, workspace: { ...options.workspace, workspacePath: resolved } };
		// One translator per chat. A template is cloned so its state belongs to this session.
		const source = this.deps.translator;
		const translator =
			typeof source === "function"
				? source()
				: typeof source.fresh === "function"
					? source.fresh()
					: source;
		return new ClaudeSession(
			{
				...this.deps,
				executablePath: program.value.path,
				viaRuntime: program.value.viaRuntime,
				translator,
			},
			start,
		);
	}

	async listModels(context: ListingContext): Promise<ModelInfo[]> {
		const program = await this.requireProgram(context);
		const metadata = this.metadataQuery(program, context.env);
		try {
			const models = await metadata.query.supportedModels();
			return models.map(toModelInfo);
		} finally {
			metadata.end();
		}
	}

	async listSlashCommands(
		workspacePath: string,
		context: ListingContext,
	): Promise<RunnerSlashCommand[]> {
		const program = await this.requireProgram(context);
		const metadata = this.metadataQuery(program, context.env, workspacePath);
		try {
			const commands = await metadata.query.supportedCommands();
			return commands.map(toRunnerSlashCommand);
		} finally {
			metadata.end();
		}
	}

	async listMcpServers(workspacePath: string, context: ListingContext): Promise<McpServerView[]> {
		const program = await this.requireProgram(context);
		const metadata = this.metadataQuery(program, context.env, workspacePath);
		try {
			const servers = await metadata.query.mcpServerStatus();
			return servers.map(toMcpServerView);
		} finally {
			metadata.end();
		}
	}

	/** The program a listing runs, by the rule a chat's start uses (`findAgentProgram`). */
	private async requireProgram(context: ListingContext): Promise<AgentProgram> {
		const program = await findAgentProgram({
			agent: "claude",
			name: "claude",
			executablePath: context.executablePath,
			env: context.env,
			findExecutable: this.deps.findExecutable,
		});
		if (!program.ok) throw program.error;
		return program.value;
	}

	/**
	 * A throwaway query for asking the CLI about models or slash commands. Its prompt never yields,
	 * and `end()` aborts the process so nothing is left behind.
	 */
	private metadataQuery(
		program: AgentProgram,
		env: Readonly<Record<string, string>>,
		cwd?: string,
	): { query: Query; end(): void } {
		const abort = new AbortController();
		const prompt = createMetadataPrompt();
		const query = this.deps.query({
			prompt: prompt.iterable,
			options: {
				abortController: abort,
				pathToClaudeCodeExecutable: program.path,
				// A `.js` program runs through node, as a chat's start does (options.ts).
				...(program.viaRuntime ? { executable: "node" as const } : {}),
				env: { ...env },
				permissionMode: "default",
				settingSources: [...CLAUDE_SETTING_SOURCES],
				...(cwd === undefined ? {} : { cwd }),
			},
		});
		return {
			query,
			end: () => {
				prompt.finish();
				abort.abort();
			},
		};
	}
}

/**
 * The SDK marks only its own commands as builtin. A project, user or plugin command is unmarked,
 * and the SDK does not say which of those three it is, so each is reported as a project command.
 */
function toRunnerSlashCommand(command: SdkSlashCommand): RunnerSlashCommand {
	const entry: RunnerSlashCommand = {
		name: command.name,
		description: command.description,
		source: slashCommandSource(command),
		kind: "command",
	};
	if (command.argumentHint !== "") entry.argumentHint = command.argumentHint;
	return entry;
}

function slashCommandSource(command: SdkSlashCommand): NonNullable<RunnerSlashCommand["source"]> {
	if (command.name.startsWith("mcp__")) return "mcp";
	if (command.builtin === true) return "builtin";
	if (command.name.includes(":")) return "plugin";
	return "project";
}

function toMcpServerView(server: SdkMcpServerStatus): McpServerView {
	const view: McpServerView = {
		name: server.name,
		status: mcpStatus(server.status),
	};
	if (server.tools !== undefined) {
		view.toolCount = server.tools.length;
		view.tools = server.tools.map((tool) => tool.name);
	}
	if (server.error !== undefined) view.error = server.error;
	const transport = mcpTransport(server.config);
	if (transport !== undefined) view.transport = transport;
	const scope = mcpScope(server.scope, server.source);
	if (scope !== undefined) view.scope = scope;
	return view;
}

function mcpStatus(status: SdkMcpServerStatus["status"]): McpServerView["status"] {
	switch (status) {
		case "connected":
			return "connected";
		case "failed":
			return "failed";
		case "needs-auth":
			return "needs_auth";
		case "pending":
			return "pending";
		case "disabled":
			return "disabled";
	}
}

function mcpTransport(config: McpServerStatusConfig | undefined): McpServerView["transport"] {
	if (config === undefined) return undefined;
	switch (config.type) {
		case "stdio":
		case undefined:
			return "stdio";
		case "http":
		case "claudeai-proxy":
			return "http";
		case "sse":
			return "sse";
		case "sdk":
			return undefined;
	}
}

function mcpScope(scope: string | undefined, source: string | undefined): McpServerView["scope"] {
	if (source === "plugin" || scope === "plugin") return "plugin";
	if (scope === "user" || scope === "project" || scope === "local") return scope;
	return undefined;
}

const EFFORT_LEVELS: ReadonlySet<string> = new Set([
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultra",
	"ultracode",
]);

function isOurEffort(value: string): value is Effort {
	return EFFORT_LEVELS.has(value);
}

function toModelInfo(model: SdkModelInfo): ModelInfo {
	const efforts = (model.supportedEffortLevels ?? []).filter(isOurEffort);
	// The middle of the levels offered is the least surprising default when the SDK names none.
	const middle = efforts[Math.floor((efforts.length - 1) / 2)];
	return {
		id: model.value,
		label: model.displayName,
		status: "picker",
		isNew: false,
		isDefault: false,
		efforts,
		defaultEffort: middle ?? "medium",
		effortAxis: "effort",
		liveEffortChange: efforts.length > 0,
		supportsFastMode: model.supportsFastMode ?? false,
	};
}

/** A prompt that yields nothing until `finish()` is called, for a metadata-only query. */
function createMetadataPrompt(): { iterable: AsyncIterable<SDKUserMessage>; finish(): void } {
	let finish: () => void = () => {};
	const done = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const iterable: AsyncIterable<SDKUserMessage> = {
		[Symbol.asyncIterator]() {
			return {
				next: () => done.then(() => ({ value: undefined, done: true })),
			};
		},
	};
	return { iterable, finish };
}
