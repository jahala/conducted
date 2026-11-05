/**
 * @feature AGENT-11 ACP client and runner (runner)
 * Owns: the Runner for one ACP agent. There is one AcpRunner per adapter (OpenCode, Pi), each with
 * the adapter's descriptor.
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
 *  - capabilities: interrupt true (session/cancel), steer false, resumeAt false, liveConfig true
 *    (model and options between turns), slashCommands true, mcpServers false, contextUsage true
 * Test first: capabilities.steer is false for both adapters.
 * Our design choice: a client factory is a dependency, so the model and command listing can be
 * tested without starting an agent process.
 */
import type { SessionConfigOption, SessionNotification } from "@agentclientprotocol/sdk";
import type { ModelInfo } from "@conducted/protocol";
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

export type AcpRunnerDeps = RunnerCommonDeps & {
	adapter: AcpAdapter;
	spawn: SpawnAcpChild;
	/** Makes a client for a throwaway session; the composition root leaves it out. */
	createClient?(options: {
		executablePath: string;
		cwd: string;
		env: Readonly<Record<string, string>>;
		handlers: AcpClientHandlers;
	}): AcpClient;
};

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

	detect(env: Readonly<Record<string, string>>): Promise<{ path: string; version: string } | null> {
		this.lastEnv = env;
		return notImplemented("AGENT-11");
	}

	start(_options: StartOptions): Promise<AgentSession> {
		return notImplemented("AGENT-11");
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
}
