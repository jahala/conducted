/**
 * @feature AGENT-11 ACP client and runner (runner)
 * Owns: the Runner for one ACP agent. There is one AcpRunner per adapter (OpenCode, Pi), each with
 * the adapter's descriptor, its model discovery, slash commands and adapter hooks.
 * Behaviour: research/conductor/other-runners.md sections 2.2 and 5: one child process per chat,
 * started through the adapter descriptor; the program is found on the login-shell PATH and its
 * version is read and compared with the adapter's minimum. Models come from the `model` config
 * option after session/new on a throwaway session (up to 15 s for OpenCode, with a longer adapter
 * wait capped at 90 s); slash commands come from available_commands_update. The shared client and
 * session do the protocol work; sign-in is the agent's own business.
 * Must handle:
 *  - detect(): program missing gives null; a version below the adapter's minimum is logged with the
 *    adapter and its minimum (the real version is still returned, so the detector can report it)
 *  - start(): one child per chat through StdioAcpClient, running the program the chat's launch
 *    names (SIDE-21, `findAgentProgram`: the user's path, else the copy on the login-shell PATH; a
 *    user path that cannot run is an error that names it); an agent older than the adapter's
 *    minimum is refused with an AgentUpdateNeededError before a child starts; the app tools MCP servers are
 *    passed to session/new when the caller supplies them, and the client keeps only the transports
 *    the agent advertised; the adapter's environment, session storage and prompt check are applied
 *  - listModels(): the throwaway session is always closed, also on error and on timeout; the model
 *    option may arrive in a config_option_update after session/new; an adapter that asked to wait
 *    and still has no model option fails with acp_model_list_timeout
 *  - listSlashCommands(): from the throwaway session's available commands, waiting up to 2 s
 *  - capabilities: interrupt true (session/cancel), steer false, resumeAt false, liveConfig true
 *    (model and options between turns), slashCommands true, mcpServers true (the app tools servers),
 *    contextUsage true
 * Test first: capabilities.steer is false for both adapters.
 * Our design choice: a client factory is a dependency, so the model and command listing can be
 * tested without starting an agent process. The listing sessions use the environment from
 * detect() only; they do not apply the adapter's approval policy or session storage.
 */
import type {
	ContentBlock,
	SessionConfigOption,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import type { ModelInfo } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { parseVersion, VERSION_PROBE_TIMEOUT_MS } from "../../models/agent-detection.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import { findAgentProgram } from "../launch-env.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import {
	type AcpClient,
	type AcpClientHandlers,
	type SpawnAcpChild,
	StdioAcpClient,
} from "./acp-client.ts";
import { AcpSession } from "./acp-session.ts";
import {
	ACP_COMMAND_LIST_WAIT_MS,
	type AcpAdapter,
	modelCatalogWaitMs,
	modelOptionFromConfig,
	modelsFromConfigOptions,
} from "./adapters/adapter.ts";
import { AcpTranslator } from "./translate.ts";

/** The tag every ACP runner log line carries. */
const ACP_LOG_TAG = "AcpAgentRunner";

/** The agent program is older than its adapter supports. */
class AgentUpdateNeededError extends Error {
	override readonly name = "AgentUpdateNeededError";
}

export type AcpRunnerDeps = RunnerCommonDeps & {
	adapter: AcpAdapter;
	spawn: SpawnAcpChild;
	/**
	 * Builds the app tools MCP servers for a chat, and the release that ends the chat's bridge token
	 * when the session is disposed (SIDE-13). Missing: no app tools are offered.
	 */
	appToolsServers?(options: StartOptions): Promise<AcpAppTools>;
	/** Overrides the translator; a test injection point the composition root leaves out. */
	translator?(options: { adapter: AcpAdapter; logger: RunnerCommonDeps["logger"] }): AcpTranslator;
	/** Makes a client for a chat or a throwaway session; the composition root leaves it out. */
	createClient?(options: {
		executablePath: string;
		cwd: string;
		env: Readonly<Record<string, string>>;
		handlers: AcpClientHandlers;
	}): AcpClient;
};

/** The app tools MCP servers for one ACP session. */
export interface AcpAppTools {
	servers: readonly unknown[];
	release(): void;
}

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
		mcpServers: true,
		contextUsage: true,
	};

	private lastEnv: Readonly<Record<string, string>> = {};

	constructor(protected readonly deps: AcpRunnerDeps) {}

	async detect(
		env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		this.lastEnv = env;
		const path = await this.deps.findExecutable(this.deps.adapter.command.executable, env);
		if (path === null) return null;
		return { path, version: await this.readVersion(path, env) };
	}

	/** The program's version, or "" when the probe fails. A version below the minimum is logged. */
	private async readVersion(path: string, env: Readonly<Record<string, string>>): Promise<string> {
		const probed = await this.deps.probe(path, this.deps.adapter.versionArgs, {
			env,
			timeoutMs: VERSION_PROBE_TIMEOUT_MS,
		});
		if (!probed.ok) {
			this.deps.logger.warn("Could not read the ACP agent version", {
				adapter: this.deps.adapter.id,
				code: probed.error.code,
			});
			return "";
		}
		const version = parseVersion(probed.value.stdout || probed.value.stderr) ?? "";
		if (version !== "" && isVersionBelow(version, this.deps.adapter.minimumVersion)) {
			this.deps.logger.warn("The ACP agent is older than the adapter supports", {
				adapter: this.deps.adapter.id,
				version,
				minimumVersion: this.deps.adapter.minimumVersion,
			});
		}
		return version;
	}

	async start(options: StartOptions): Promise<AgentSession> {
		const logger = this.deps.logger.child(ACP_LOG_TAG);
		this.lastEnv = options.env;
		const program = await findAgentProgram({
			agent: "acp",
			name: this.deps.adapter.command.executable,
			executablePath: options.executablePath,
			env: options.env,
			findExecutable: this.deps.findExecutable,
		});
		if (!program.ok) throw program.error;
		const executablePath = program.value.path;
		const detected = {
			path: executablePath,
			version: await this.readVersion(executablePath, options.env),
		};
		if (
			detected.version !== "" &&
			isVersionBelow(detected.version, this.deps.adapter.minimumVersion)
		) {
			throw new AgentUpdateNeededError(
				`The ${this.deps.adapter.displayName} agent is version ${detected.version}. This app needs ${this.deps.adapter.minimumVersion} or newer. Update ${this.deps.adapter.command.executable} and try again.`,
			);
		}
		const storage = this.deps.adapter.sessionStorage?.(options.workspace.workspacePath);
		const permission = this.deps.adapter.permissionEnv(options.config.requireToolApproval, {
			agentVersion: detected.version === "" ? undefined : detected.version,
			env: options.env,
		});
		if (!permission.ok) throw new Error(permission.error.message);
		const env = {
			...options.env,
			...(storage?.env ?? {}),
			...permission.value,
		};
		const translator = this.makeTranslator(logger);
		let availableCommands: string[] = [];
		let session: AcpSession | null = null;
		const connectClient = async () => {
			const handlers: AcpClientHandlers = {
				onSessionUpdate: (notification) => {
					if (notification.update.sessionUpdate === "available_commands_update") {
						availableCommands = notification.update.availableCommands.map(
							(command) => command.name,
						);
					}
					session?.handleUpdate(notification);
				},
				requestPermission: (request) =>
					session?.requestPermission(request) ??
					Promise.resolve({ outcome: { outcome: "cancelled" } }),
				requestElicitation: (request) =>
					session?.requestElicitation(request) ?? Promise.resolve({ action: "cancel" }),
				beforeWrite: () => session?.beforeWrite() ?? Promise.resolve(),
				lastOutput: () => session?.lastOutput() ?? "",
			};
			const client = this.createClient(
				executablePath,
				options.workspace.workspacePath,
				env,
				handlers,
			);
			const connected = await client.connect();
			if (!connected.ok) {
				await client.close();
				throw new Error(connected.error.message);
			}
			return new GuardedAcpClient(
				client,
				this.deps.adapter,
				() => availableCommands,
				storage?.sessionIdPrefix,
			);
		};
		const appTools = (await this.deps.appToolsServers?.(options)) ?? null;
		session = new AcpSession(
			{
				adapter: this.deps.adapter,
				connectClient,
				translator,
				mcpServers: appTools?.servers ?? [],
				logger,
				...(appTools === null ? {} : { onDispose: () => appTools.release() }),
			},
			options,
		);
		return session;
	}

	async listModels(): Promise<ModelInfo[]> {
		const started = this.deps.clock.now();
		const executablePath = await this.requirePath();
		const collector = new AcpUpdateCollector();
		const client = this.createClient(
			executablePath,
			process.cwd(),
			this.lastEnv,
			collector.handlers,
		);
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
				if (modelOptionFromConfig(collector.options) === undefined) {
					throw appError(
						"acp_model_list_timeout",
						`The ${this.deps.adapter.displayName} agent did not report its model list in time. The provider may need sign-in.`,
					);
				}
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
		const client = this.createClient(
			executablePath,
			workspacePath,
			this.lastEnv,
			collector.handlers,
		);
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
		env: Readonly<Record<string, string>>,
		handlers: AcpClientHandlers,
	): AcpClient {
		if (this.deps.createClient !== undefined) {
			return this.deps.createClient({ executablePath, cwd, env, handlers });
		}
		return new StdioAcpClient({
			spawn: this.deps.spawn,
			adapter: this.deps.adapter,
			executablePath,
			cwd,
			env,
			handlers,
			logger: this.deps.logger,
		});
	}

	private makeTranslator(logger: RunnerCommonDeps["logger"]): AcpTranslator {
		if (this.deps.translator !== undefined) {
			return this.deps.translator({ adapter: this.deps.adapter, logger });
		}
		return new AcpTranslator({ toolNameHints: this.deps.adapter.toolNameHints, logger });
	}
}

/**
 * Applies the adapter's prompt check and session id prefix to a client the session owns.
 * The prefix is removed from a resume id before it reaches the agent and added back to the id the
 * agent reports, so the stored id stays unique while the agent sees its own ids.
 */
class GuardedAcpClient implements AcpClient {
	constructor(
		private readonly inner: AcpClient,
		private readonly adapter: AcpAdapter,
		private readonly commands: () => readonly string[],
		private readonly prefix: string | undefined,
	) {}

	connect(): ReturnType<AcpClient["connect"]> {
		return this.inner.connect();
	}

	async openSession(
		options: Parameters<AcpClient["openSession"]>[0],
	): ReturnType<AcpClient["openSession"]> {
		const requested =
			options.resumeSessionId === undefined
				? options
				: { ...options, resumeSessionId: this.agentId(options.resumeSessionId) };
		const opened = await this.inner.openSession(requested);
		if (!opened.ok || this.prefix === undefined) return opened;
		return ok({
			...opened.value,
			acpSessionId: `${this.prefix}${opened.value.acpSessionId}`,
		});
	}

	prompt(acpSessionId: string, content: ContentBlock[]): ReturnType<AcpClient["prompt"]> {
		const check = this.adapter.checkPrompt;
		if (check !== undefined) {
			const text = content
				.filter((block) => block.type === "text")
				.map((block) => (block.type === "text" ? block.text : ""))
				.join("");
			const checked = check(text, this.commands());
			if (!checked.ok) return Promise.resolve(err(checked.error));
		}
		return this.inner.prompt(this.agentId(acpSessionId), content);
	}

	cancel(acpSessionId: string): void {
		this.inner.cancel(this.agentId(acpSessionId));
	}

	setConfigOption(
		acpSessionId: string,
		optionId: string,
		value: string | boolean,
	): ReturnType<AcpClient["setConfigOption"]> {
		return this.inner.setConfigOption(this.agentId(acpSessionId), optionId, value);
	}

	setMode(acpSessionId: string, modeId: string): ReturnType<AcpClient["setMode"]> {
		return this.inner.setMode(this.agentId(acpSessionId), modeId);
	}

	private agentId(sessionId: string): string {
		return this.prefix !== undefined && sessionId.startsWith(this.prefix)
			? sessionId.slice(this.prefix.length)
			: sessionId;
	}

	setConfigOptions(options: SessionConfigOption[]): void {
		this.inner.setConfigOptions?.(options);
	}

	onClose(listener: (reason: string) => void): void {
		this.inner.onClose(listener);
	}

	close(): Promise<void> {
		return this.inner.close();
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
			requestElicitation: async () => ({ action: "cancel" }),
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
