/**
 * @feature AGENT-06 Codex: threads, steer, interrupt (runner)
 * Owns: the Runner for Codex: finding the program, its version, starting a CodexSession, listing
 * models, skills and MCP servers.
 * Behaviour: research/conductor/other-runners.md sections 1, 2.1 and 5: models come from
 * `model/list` on a temporary app server (paged, hidden models dropped); the sign-in state from
 * `account/read`; Codex answers slash commands (as skills).
 * Must handle:
 *  - detect(): `codex` not on PATH gives null; `codex --version` prints "codex-cli <version>"
 *  - listModels(): pages until nextCursor is null, drops hidden models, maps the supported
 *    reasoning efforts to our effort names (efforts we do not know are dropped, not renamed)
 *  - the app tools reach Codex as an MCP server entry in the thread config (tools/mcp-launch.ts);
 *    the entry is built at start() from the bridge endpoint and token, and the session gives the
 *    token back when it is disposed (SIDE-13)
 *  - start() runs the program the chat's launch names (SIDE-21, `findAgentProgram`): the user's
 *    path, else the copy on the login-shell PATH; a user path that cannot run is an error that
 *    names it
 *  - listSlashCommands(): from `skills/list`; names are shown with the leading slash by the UI,
 *    each entry is a skill, and its scope (user, repo, system) and plugin id give its source
 *  - listMcpServers(): pages `mcpServerStatus/list`; its connection state, tool names, scope and
 *    error text become the protocol server shape
 *  - capabilities: steer, interrupt, resumeAt (thread rollback), slashCommands, mcpServers and
 *    contextUsage (from token notifications) are true; liveConfig is true for model and effort
 * Test first: detect() parses "codex-cli 0.154.0" to version "0.154.0".
 */
import type { Effort, ModelInfo } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { parseVersion, VERSION_PROBE_TIMEOUT_MS } from "../../models/agent-detection.ts";
import { AGENT_NOT_INSTALLED } from "../../models/catalog.ts";
import { asRecord, isRecord } from "../../util/records.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import { findAgentProgram } from "../launch-env.ts";
import type {
	AgentSession,
	McpServerView,
	Runner,
	RunnerCapabilities,
	RunnerSlashCommand,
	StartOptions,
} from "../runner.ts";
import {
	CODEX_CHEAP_CALL_TIMEOUT_MS,
	JsonRpcCodexClient,
	type SpawnJsonRpcChild,
} from "./app-server-client.ts";
import { CodexSession } from "./codex-session.ts";
import { CODEX_CLIENT_METHODS, type CodexModel, type CodexModelListResult } from "./protocol.ts";
import { CodexTranslator } from "./translate.ts";

/** The name Codex reports back for our client in the initialize handshake. */
export const CODEX_CLIENT_NAME = "conducted";
/** Our client version in the initialize handshake. */
export const CODEX_CLIENT_VERSION = "0.1.0";

export type CodexRunnerDeps = RunnerCommonDeps & {
	spawn: SpawnJsonRpcChild;
	random(): number;
	sleep(ms: number): Promise<void>;
	/**
	 * Builds the `--config` arguments and child environment for the app tools MCP server, and the
	 * release that ends the chat's bridge token when the session is disposed.
	 */
	appToolsConfig(options: StartOptions): Promise<CodexAppTools>;
};

/** The app tools server for one Codex session. */
export interface CodexAppTools {
	args: readonly string[];
	env: Readonly<Record<string, string>>;
	release(): void;
}

export interface CodexAccount {
	authenticated: boolean;
	authMethod?: string;
}

export class CodexRunner implements Runner {
	readonly agent = "codex" as const;
	readonly capabilities: RunnerCapabilities = {
		steer: true,
		interrupt: true,
		resumeAt: true,
		liveConfig: true,
		slashCommands: true,
		mcpServers: true,
		contextUsage: true,
	};

	private lastEnv: Readonly<Record<string, string>> = {};
	private detectedPath: string | null = null;

	constructor(protected readonly deps: CodexRunnerDeps) {}

	async detect(
		env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		this.lastEnv = env;
		const path = await this.deps.findExecutable("codex", env);
		if (path === null) {
			this.detectedPath = null;
			return null;
		}
		this.detectedPath = path;
		const probed = await this.deps.probe(path, ["--version"], {
			env,
			timeoutMs: VERSION_PROBE_TIMEOUT_MS,
		});
		if (!probed.ok) {
			this.deps.logger.warn("Could not read the Codex version", {
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
		const program = await findAgentProgram({
			agent: "codex",
			name: "codex",
			executablePath: options.executablePath,
			env: options.env,
			findExecutable: this.deps.findExecutable,
			findManagedProgram: this.deps.findManagedProgram,
		});
		if (!program.ok) throw program.error;
		const codexPath = program.value.path;
		const translator = new CodexTranslator({ logger: this.deps.logger });
		const appTools = await this.deps.appToolsConfig(options);
		return new CodexSession(
			{
				connectClient: async () => {
					const client = this.createClient({
						codexPath,
						cwd: options.workspace.workspacePath,
						env: { ...options.env, ...appTools.env },
						extraArgs: appTools.args,
					});
					const connected = await client.connect();
					if (!connected.ok) {
						await client.close();
						throw connected.error;
					}
					return client;
				},
				translator,
				logger: this.deps.logger,
				random: () => this.deps.random(),
				sleep: (ms) => this.deps.sleep(ms),
				onDispose: () => appTools.release(),
				...(options.onGoalEvent === undefined ? {} : { onGoalEvent: options.onGoalEvent }),
			},
			options,
		);
	}

	async listModels(): Promise<ModelInfo[]> {
		const codexPath = await this.requirePath(this.lastEnv);
		const client = this.createClient({
			codexPath,
			cwd: process.cwd(),
			env: this.lastEnv,
			extraArgs: [],
		});
		const connected = await client.connect();
		if (!connected.ok) throw connected.error;
		try {
			const models: ModelInfo[] = [];
			let cursor: string | null = null;
			do {
				const page: Result<CodexModelListResult, AppError> =
					await client.request<CodexModelListResult>(
						CODEX_CLIENT_METHODS.modelList,
						{ cursor, includeHidden: true },
						{ timeoutMs: CODEX_CHEAP_CALL_TIMEOUT_MS },
					);
				if (!page.ok) throw page.error;
				for (const model of page.value.data) {
					if (!model.hidden) models.push(toModelInfo(model));
				}
				cursor = page.value.nextCursor;
			} while (cursor !== null);
			return models;
		} finally {
			await client.close();
		}
	}

	async listSlashCommands(workspacePath: string): Promise<RunnerSlashCommand[]> {
		const codexPath = await this.requirePath(this.lastEnv);
		const client = this.createClient({
			codexPath,
			cwd: workspacePath,
			env: this.lastEnv,
			extraArgs: [],
		});
		const connected = await client.connect();
		if (!connected.ok) throw connected.error;
		try {
			const listed = await client.request<unknown>(
				CODEX_CLIENT_METHODS.skillsList,
				{ cwds: [workspacePath] },
				{ timeoutMs: CODEX_CHEAP_CALL_TIMEOUT_MS },
			);
			if (!listed.ok) throw listed.error;
			return readSkills(listed.value);
		} finally {
			await client.close();
		}
	}

	async listMcpServers(workspacePath: string): Promise<McpServerView[]> {
		const codexPath = await this.requirePath(this.lastEnv);
		const client = this.createClient({
			codexPath,
			cwd: workspacePath,
			env: this.lastEnv,
			extraArgs: [],
		});
		const connected = await client.connect();
		if (!connected.ok) throw connected.error;
		try {
			const servers: McpServerView[] = [];
			let cursor: string | null = null;
			do {
				const page = await client.request<unknown>(
					CODEX_CLIENT_METHODS.mcpServerStatusList,
					{ cursor, detail: "full" },
					{ timeoutMs: CODEX_CHEAP_CALL_TIMEOUT_MS },
				);
				if (!page.ok) throw page.error;
				const parsed = readMcpServers(page.value);
				servers.push(...parsed.servers);
				cursor = parsed.nextCursor;
			} while (cursor !== null);
			return servers;
		} finally {
			await client.close();
		}
	}

	/** The sign-in state the agent detector reads through the Codex app server. */
	async account(env: Readonly<Record<string, string>>): Promise<Result<CodexAccount, AppError>> {
		const codexPath = await this.deps.findExecutable("codex", env);
		if (codexPath === null) return err(codexNotInstalled());
		const client = this.createClient({
			codexPath,
			cwd: process.cwd(),
			env,
			extraArgs: [],
		});
		const connected = await client.connect();
		if (!connected.ok) return connected;
		try {
			const read = await client.request<unknown>(
				CODEX_CLIENT_METHODS.accountRead,
				{},
				{ timeoutMs: CODEX_CHEAP_CALL_TIMEOUT_MS },
			);
			if (!read.ok) return read;
			return ok(readAccount(read.value));
		} finally {
			await client.close();
		}
	}

	private createClient(options: {
		codexPath: string;
		cwd: string;
		env: Readonly<Record<string, string>>;
		extraArgs: readonly string[];
	}): JsonRpcCodexClient {
		return new JsonRpcCodexClient({
			spawn: this.deps.spawn,
			codexPath: options.codexPath,
			cwd: options.cwd,
			env: options.env,
			extraArgs: options.extraArgs,
			clientName: CODEX_CLIENT_NAME,
			clientVersion: CODEX_CLIENT_VERSION,
			logger: this.deps.logger,
		});
	}

	private async requirePath(env: Readonly<Record<string, string>>): Promise<string> {
		const path = this.detectedPath ?? (await this.deps.findExecutable("codex", env));
		if (path === null) throw codexNotInstalled();
		return path;
	}
}

function codexNotInstalled(): AppError {
	return appError(
		AGENT_NOT_INSTALLED,
		"Codex was not found. Install it in settings and try again.",
	);
}

const OUR_EFFORTS: ReadonlySet<string> = new Set([
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
	return OUR_EFFORTS.has(value);
}

function toModelInfo(model: CodexModel): ModelInfo {
	const efforts = model.supportedReasoningEfforts
		.map((entry) => entry.reasoningEffort)
		.filter(isOurEffort);
	const defaultEffort = isOurEffort(model.defaultReasoningEffort)
		? model.defaultReasoningEffort
		: (efforts[0] ?? "medium");
	return {
		id: model.id,
		label: model.displayName,
		status: "picker",
		isNew: false,
		isDefault: model.isDefault,
		efforts,
		defaultEffort,
		effortAxis: "effort",
		liveEffortChange: efforts.length > 0,
		supportsFastMode: false,
	};
}

/** `skills/list` answers `{data: [{cwd, skills, errors}]}`; an older shape puts skills at the root. */
function readSkills(value: unknown): RunnerSlashCommand[] {
	const root = asRecord(value);
	if (root === null) return [];
	const commands: RunnerSlashCommand[] = [];
	for (const skill of skillEntries(root)) {
		const name = skill.name;
		if (typeof name !== "string" || name === "") continue;
		const command: RunnerSlashCommand = {
			name,
			description: typeof skill.description === "string" ? skill.description : "",
			source: skillSource(skill),
			kind: "skill",
		};
		if (typeof skill.argumentHint === "string" && skill.argumentHint !== "") {
			command.argumentHint = skill.argumentHint;
		}
		commands.push(command);
	}
	return commands;
}

function skillEntries(root: Record<string, unknown>): Record<string, unknown>[] {
	if (Array.isArray(root.skills)) return root.skills.map(asRecord).filter(isRecord);
	if (!Array.isArray(root.data)) return [];
	const entries: Record<string, unknown>[] = [];
	for (const item of root.data) {
		const group = asRecord(item);
		if (group === null) continue;
		if (Array.isArray(group.skills)) {
			for (const skill of group.skills) {
				const record = asRecord(skill);
				if (record !== null) entries.push(record);
			}
		} else {
			entries.push(group);
		}
	}
	return entries;
}

function skillSource(skill: Record<string, unknown>): NonNullable<RunnerSlashCommand["source"]> {
	if (typeof skill.pluginId === "string" && skill.pluginId !== "") return "plugin";
	switch (skill.scope) {
		case "user":
			return "user";
		case "repo":
			return "project";
		case "system":
		case "admin":
			return "builtin";
	}
	// A skill with no scope is the user's own; Codex always reports a scope today.
	return "user";
}

function readMcpServers(value: unknown): { servers: McpServerView[]; nextCursor: string | null } {
	const root = asRecord(value);
	if (root === null) return { servers: [], nextCursor: null };
	const list = Array.isArray(root.data)
		? root.data
		: Array.isArray(root.servers)
			? root.servers
			: [];
	const servers: McpServerView[] = [];
	for (const entry of list) {
		const server = asRecord(entry);
		if (server === null) continue;
		const name = server.name;
		if (typeof name !== "string" || name === "") continue;
		servers.push(toMcpServerView(server));
	}
	const nextCursor = typeof root.nextCursor === "string" ? root.nextCursor : null;
	return { servers, nextCursor };
}

function toMcpServerView(server: Record<string, unknown>): McpServerView {
	const tools = asRecord(server.tools);
	const toolNames =
		tools === null ? undefined : Object.values(tools).map(toolName).filter(isString);
	const error = typeof server.toolsError === "string" ? server.toolsError : undefined;
	const view: McpServerView = {
		name: server.name as string,
		status: codexMcpStatus(server.runtimeStatus, server.authStatus, toolNames, error),
	};
	if (toolNames !== undefined) {
		view.toolCount = toolNames.length;
		view.tools = toolNames;
	}
	if (error !== undefined) view.error = error;
	if (typeof server.pluginId === "string" && server.pluginId !== "") view.scope = "plugin";
	return view;
}

function codexMcpStatus(
	runtime: unknown,
	auth: unknown,
	tools: string[] | undefined,
	error: string | undefined,
): McpServerView["status"] {
	switch (runtime) {
		case "connected":
			return "connected";
		case "failed":
		case "cancelled":
			return "failed";
		case "authenticationRequired":
			return "needs_auth";
		case "disabled":
			return "disabled";
		case "notStarted":
		case "starting":
			return "pending";
	}
	if (error !== undefined) return "failed";
	if (auth === "notLoggedIn") return "needs_auth";
	if (tools !== undefined && tools.length > 0) return "connected";
	return "pending";
}

function toolName(tool: unknown): string | undefined {
	const record = asRecord(tool);
	return record !== null && typeof record.name === "string" ? record.name : undefined;
}

function isString(value: string | undefined): value is string {
	return value !== undefined;
}

function readAccount(value: unknown): CodexAccount {
	const root = asRecord(value);
	if (root === null) return { authenticated: false };
	const account = asRecord(root.account);
	if (account === null) return { authenticated: false };
	const method = account.type;
	return {
		authenticated: true,
		...(typeof method === "string" ? { authMethod: method } : {}),
	};
}
