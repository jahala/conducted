/**
 * @feature AGENT-11 ACP client and runner (runner)
 * Owns: the Runner for one ACP agent. There is one AcpRunner per adapter (OpenCode, Pi), each with
 * the adapter's descriptor.
<<<<<<< HEAD
 * Behaviour: research/conductor/other-runners.md section 2.2: one child process per chat, started
 * through the adapter descriptor; the program is found on the login-shell PATH and its version is
 * read and compared with the adapter's minimum. The shared client and session do the protocol
 * work. Model discovery and slash commands are AGENT-12's.
 * Must handle:
 *  - detect(): program missing gives null; a version below the adapter's minimum is logged with the
 *    adapter and its minimum (the real version is still returned, so the detector can report it)
 *  - start(): one child per chat through StdioAcpClient; the app tools MCP server is passed to
 *    session/new when the caller supplies it
 *  - listModels() and listSlashCommands(): owned by AGENT-12
=======
 * Behaviour: research/conductor/other-runners.md sections 2.2 and 5: the program is found on the
 * login-shell PATH and its version checked against the adapter's minimum; models come from the
 * `model` config option after session/new on a throwaway session (up to 15 s for OpenCode,
 * with a longer adapter wait capped at 90 s); slash commands come from
 * available_commands_update; sign-in is the agent's own business.
 * Must handle:
 *  - detect(): program missing gives null; version below minimum gives the version with a flag the
 *    detector turns into "update needed" (we return the real version; the comparison is in
 *    models/agent-detection.ts)
 *  - listModels(): the throwaway session is always closed, also on error and on timeout; the model
 *    option may arrive in a config_option_update after session/new
 *  - listSlashCommands(): from the throwaway session's available commands, waiting up to 2 s
>>>>>>> node/agent.12
 *  - capabilities: interrupt true (session/cancel), steer false, resumeAt false, liveConfig true
 *    (model and options between turns), slashCommands true, mcpServers true (the app tools server),
 *    contextUsage true
 * Test first: capabilities.steer is false for both adapters.
 * Our design choice: a client factory is a dependency, so the model and command listing can be
 * tested without starting an agent process.
 */
import type { SessionConfigOption, SessionNotification } from "@agentclientprotocol/sdk";
import type { ModelInfo } from "@conducted/protocol";
<<<<<<< HEAD
import { notImplemented } from "@conducted/shared";
import { parseVersion, VERSION_PROBE_TIMEOUT_MS } from "../../models/agent-detection.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import { type SpawnAcpChild, StdioAcpClient } from "./acp-client.ts";
import { AcpSession } from "./acp-session.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";
import { AcpTranslator } from "./translate.ts";

/** The tag every ACP runner log line carries. */
const ACP_LOG_TAG = "AcpAgentRunner";
=======
import { appError, err, notImplemented } from "@conducted/shared";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import {
	type AcpClient,
	type AcpClientHandlers,
	type SpawnAcpChild,
	StdioAcpClient,
} from "./acp-client.ts";
import {
	ACP_COMMAND_LIST_WAIT_MS,
	type AcpAdapter,
	modelCatalogWaitMs,
	modelOptionFromConfig,
	modelsFromConfigOptions,
} from "./adapters/adapter.ts";
>>>>>>> node/agent.12

export type AcpRunnerDeps = RunnerCommonDeps & {
	adapter: AcpAdapter;
	spawn: SpawnAcpChild;
<<<<<<< HEAD
	/** Builds the app tools MCP servers for a chat. Missing: no app tools are offered. */
	appToolsServers?(options: StartOptions): readonly unknown[];
	/** Makes the translator. AGENT-12 supplies it in the composition root. */
	translator?(options: { adapter: AcpAdapter; logger: RunnerCommonDeps["logger"] }): AcpTranslator;
=======
	/** Makes a client for a throwaway session; the composition root leaves it out. */
	createClient?(options: {
		executablePath: string;
		cwd: string;
		env: Readonly<Record<string, string>>;
		handlers: AcpClientHandlers;
	}): AcpClient;
>>>>>>> node/agent.12
};

/** True when a version is older than a minimum, comparing numeric parts. */
export function isVersionBelow(version: string, minimum: string | undefined): boolean {
	if (minimum === undefined || minimum === "") return false;
	const left = version.split(/[.+-]/).map((part) => Number(part));
	const right = minimum.split(/[.+-]/).map((part) => Number(part));
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const a = left[index];
		const b = right[index];
		if (a === undefined || Number.isNaN(a)) return false;
		if (b === undefined || Number.isNaN(b)) return false;
		if (a < b) return true;
		if (a > b) return false;
	}
	return false;
}

export class AcpRunner implements Runner {
	readonly agent = "acp" as const;
	readonly capabilities: RunnerCapabilities = {
		steer: false,
		interrupt: true,
		resumeAt: false,
		liveConfig: true,
		slashCommands: true,
		mcpServers: false,
		contextUsage: true,
	};

	private lastEnv: Readonly<Record<string, string>> = {};

	constructor(protected readonly deps: AcpRunnerDeps) {}

<<<<<<< HEAD
	async detect(
		env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		const path = await this.deps.findExecutable(this.deps.adapter.command.executable, env);
		if (path === null) return null;
		const probed = await this.deps.probe(path, this.deps.adapter.versionArgs, {
			env,
			timeoutMs: VERSION_PROBE_TIMEOUT_MS,
		});
		if (!probed.ok) {
			this.deps.logger.warn("Could not read the ACP agent version", {
				adapter: this.deps.adapter.id,
				code: probed.error.code,
			});
			return { path, version: "" };
		}
		const version = parseVersion(probed.value.stdout || probed.value.stderr) ?? "";
		if (version !== "" && isVersionBelow(version, this.deps.adapter.minimumVersion)) {
			this.deps.logger.warn("The ACP agent is older than the adapter supports", {
				adapter: this.deps.adapter.id,
				version,
				minimumVersion: this.deps.adapter.minimumVersion,
			});
		}
		return { path, version };
=======
	detect(env: Readonly<Record<string, string>>): Promise<{ path: string; version: string } | null> {
		this.lastEnv = env;
		return notImplemented("AGENT-11");
>>>>>>> node/agent.12
	}

	async start(options: StartOptions): Promise<AgentSession> {
		const logger = this.deps.logger.child(ACP_LOG_TAG);
		const executablePath =
			(await this.deps.findExecutable(this.deps.adapter.command.executable, options.env)) ?? "";
		if (executablePath === "") {
			throw new Error(
				`The ${this.deps.adapter.displayName} agent could not start (${this.deps.adapter.command.executable}). Install it, or repair its path in Settings.`,
			);
		}
		const env = {
			...options.env,
			...this.deps.adapter.permissionEnv(options.config.requireToolApproval),
		};
		const translator = this.makeTranslator(logger);
		let session: AcpSession | null = null;
		const connectClient = async () => {
			const client = new StdioAcpClient({
				spawn: this.deps.spawn,
				adapter: this.deps.adapter,
				executablePath,
				cwd: options.workspace.workspacePath,
				env,
				logger,
				handlers: {
					onSessionUpdate: (notification) => session?.handleUpdate(notification),
					requestPermission: (request) =>
						session?.requestPermission(request) ??
						Promise.resolve({ outcome: { outcome: "cancelled" } }),
					requestElicitation: (request) =>
						session?.requestElicitation(request) ?? Promise.resolve({ action: "cancel" }),
					beforeWrite: () => session?.beforeWrite() ?? Promise.resolve(),
				},
			});
			const connected = await client.connect();
			if (!connected.ok) {
				await client.close();
				throw new Error(connected.error.message);
			}
			return client;
		};
		session = new AcpSession(
			{
				adapter: this.deps.adapter,
				connectClient,
				translator,
				mcpServers: this.deps.appToolsServers?.(options) ?? [],
				logger,
			},
			options,
		);
		return session;
	}

	async listModels(): Promise<ModelInfo[]> {
		const started = this.deps.clock.now();
		const executablePath = await this.requirePath();
		const collector = new AcpUpdateCollector();
		const client = this.createClient(executablePath, process.cwd(), collector.handlers);
		const connected = await client.connect();
		if (!connected.ok) {
			await client.close();
			throw connected.error;
		}
		try {
			const opened = await client.openSession({
				cwd: process.cwd(),
				additionalDirectories: [],
				mcpServers: [],
			});
			if (!opened.ok) throw opened.error;
			collector.acceptInitialOptions(opened.value.configOptions);
			if (
				this.deps.adapter.waitForModelCatalogMs > 0 &&
				modelOptionFromConfig(collector.options) === undefined
			) {
				const spent = this.deps.clock.now() - started;
				const wait = modelCatalogWaitMs(this.deps.adapter.waitForModelCatalogMs, spent);
				if (wait > 0) await collector.waitForModelOption(wait);
			}
			return modelsFromConfigOptions(collector.options);
		} finally {
			await client.close();
		}
	}

	async listSlashCommands(
		workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
		const executablePath = await this.requirePath();
		const collector = new AcpUpdateCollector();
		const client = this.createClient(executablePath, workspacePath, collector.handlers);
		const connected = await client.connect();
		if (!connected.ok) {
			await client.close();
			throw connected.error;
		}
		try {
			const opened = await client.openSession({
				cwd: workspacePath,
				additionalDirectories: [],
				mcpServers: [],
			});
			if (!opened.ok) throw opened.error;
			if (collector.commands.length === 0) {
				await collector.waitForCommands(ACP_COMMAND_LIST_WAIT_MS);
			}
			return [...collector.commands];
		} finally {
			await client.close();
		}
	}

	private async requirePath(): Promise<string> {
		const found = await this.deps.findExecutable(
			this.deps.adapter.command.executable,
			this.lastEnv,
		);
		if (found === null) {
			throw appError(
				"agent_not_installed",
				`${this.deps.adapter.displayName} is not installed. Install ${this.deps.adapter.command.executable} or add it to your PATH.`,
			);
		}
		return found;
	}

	private createClient(
		executablePath: string,
		cwd: string,
		handlers: AcpClientHandlers,
	): AcpClient {
		if (this.deps.createClient !== undefined) {
			return this.deps.createClient({
				executablePath,
				cwd,
				env: this.lastEnv,
				handlers,
			});
		}
		return new StdioAcpClient({
			spawn: this.deps.spawn,
			adapter: this.deps.adapter,
			executablePath,
			cwd,
			env: this.lastEnv,
			handlers,
			logger: this.deps.logger,
		});
	}
}

/** Collects the config options and commands a throwaway session reports. */
class AcpUpdateCollector {
	options: SessionConfigOption[] = [];
	commands: { name: string; description: string; argumentHint?: string }[] = [];
	readonly handlers: AcpClientHandlers;

	private optionWaiter: (() => void) | undefined;
	private commandWaiter: (() => void) | undefined;

	constructor() {
		this.handlers = {
			onSessionUpdate: (notification) => this.accept(notification),
			requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			readTextFile: async () =>
				err(
					appError(
						"acp_file_access_unavailable",
						"An ACP model listing does not read or write files.",
					),
				),
			writeTextFile: async () =>
				err(
					appError(
						"acp_file_access_unavailable",
						"An ACP model listing does not read or write files.",
					),
				),
		};
	}

	acceptInitialOptions(options: readonly SessionConfigOption[]): void {
		if (this.options.length === 0) this.options = [...options];
		if (modelOptionFromConfig(this.options) !== undefined) this.optionWaiter?.();
	}

	waitForModelOption(ms: number): Promise<void> {
		if (modelOptionFromConfig(this.options) !== undefined) return Promise.resolve();
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.optionWaiter = undefined;
				resolve();
			}, ms);
			this.optionWaiter = () => {
				clearTimeout(timer);
				this.optionWaiter = undefined;
				resolve();
			};
		});
	}

	waitForCommands(ms: number): Promise<void> {
		if (this.commands.length > 0) return Promise.resolve();
		return new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				this.commandWaiter = undefined;
				resolve();
			}, ms);
			this.commandWaiter = () => {
				clearTimeout(timer);
				this.commandWaiter = undefined;
				resolve();
			};
		});
	}

	private accept(notification: SessionNotification): void {
		const update = notification.update;
		if (update.sessionUpdate === "config_option_update") {
			this.options = [...update.configOptions];
			if (modelOptionFromConfig(this.options) !== undefined) this.optionWaiter?.();
			return;
		}
		if (update.sessionUpdate === "available_commands_update") {
			this.commands = update.availableCommands.map((command) => ({
				name: command.name,
				description: command.description,
				...(command.input === undefined || command.input === null
					? {}
					: { argumentHint: command.input.hint }),
			}));
			this.commandWaiter?.();
		}
	}

	private makeTranslator(logger: RunnerCommonDeps["logger"]): AcpTranslator {
		if (this.deps.translator !== undefined) {
			return this.deps.translator({ adapter: this.deps.adapter, logger });
		}
		return new AcpTranslator({ toolNameHints: this.deps.adapter.toolNameHints, logger });
	}
}
