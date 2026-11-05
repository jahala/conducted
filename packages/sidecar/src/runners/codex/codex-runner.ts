/**
 * @feature AGENT-06 Codex: threads, steer, interrupt (runner)
 * Owns: the Runner for Codex: finding the program, its version, starting a CodexSession, listing
 * models.
 * Behaviour: research/conductor/other-runners.md sections 1, 2.1 and 5: models come from
 * `model/list` on a temporary app server (paged, hidden models dropped); the sign-in state from
 * `account/read`; Codex answers slash commands (as skills).
 * Must handle:
 *  - detect(): `codex` not on PATH gives null; `codex --version` prints "codex-cli <version>"
 *  - listModels(): pages until nextCursor is null, drops hidden models, maps the supported
 *    reasoning efforts to our effort names (efforts we do not know are dropped, not renamed)
 *  - the app tools reach Codex as an MCP server entry in the thread config (tools/mcp-launch.ts);
 *    the entry is built at start() from the bridge endpoint and token
 *  - listSlashCommands(): from `skills/list`; names are shown with the leading slash by the UI
 *  - capabilities: steer, interrupt, resumeAt (thread rollback), slashCommands, mcpServers and
 *    contextUsage (from token notifications) are true; liveConfig is true for model and effort
 * Test first: detect() parses "codex-cli 0.154.0" to version "0.154.0".
 */
import type { Effort, ModelInfo } from "@conducted/protocol";
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { parseVersion, VERSION_PROBE_TIMEOUT_MS } from "../../models/agent-detection.ts";
import { AGENT_NOT_INSTALLED } from "../../models/catalog.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
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
	/** Builds the `--config` arguments that register the app tools MCP server for a chat. */
	appToolsConfigArgs(options: StartOptions): readonly string[];
};

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
		const codexPath = await this.requirePath(options.env);
		const translator = new CodexTranslator({ logger: this.deps.logger });
		return new CodexSession(
			{
				connectClient: async () => {
					const client = this.createClient({
						codexPath,
						cwd: options.workspace.workspacePath,
						env: options.env,
						extraArgs: this.deps.appToolsConfigArgs(options),
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

	async listSlashCommands(
		workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
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

function readSkills(
	value: unknown,
): { name: string; description: string; argumentHint?: string }[] {
	const root = asRecord(value);
	if (root === null) return [];
	const list = Array.isArray(root.skills) ? root.skills : Array.isArray(root.data) ? root.data : [];
	const commands: { name: string; description: string; argumentHint?: string }[] = [];
	for (const entry of list) {
		const skill = asRecord(entry);
		if (skill === null) continue;
		const name = skill.name;
		if (typeof name !== "string" || name === "") continue;
		const command: { name: string; description: string; argumentHint?: string } = {
			name,
			description: typeof skill.description === "string" ? skill.description : "",
		};
		if (typeof skill.argumentHint === "string" && skill.argumentHint !== "") {
			command.argumentHint = skill.argumentHint;
		}
		commands.push(command);
	}
	return commands;
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

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
