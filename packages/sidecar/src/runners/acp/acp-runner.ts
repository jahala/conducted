/**
 * @feature AGENT-11 ACP client and runner (runner)
 * Owns: the Runner for one ACP agent. There is one AcpRunner per adapter (OpenCode, Pi), each with
 * the adapter's descriptor.
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
 *  - capabilities: interrupt true (session/cancel), steer false, resumeAt false, liveConfig true
 *    (model and options between turns), slashCommands true, mcpServers true (the app tools server),
 *    contextUsage true
 * Test first: capabilities.steer is false for both adapters.
 */
import type { ModelInfo } from "@conducted/protocol";
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

export type AcpRunnerDeps = RunnerCommonDeps & {
	adapter: AcpAdapter;
	spawn: SpawnAcpChild;
	/** Builds the app tools MCP servers for a chat. Missing: no app tools are offered. */
	appToolsServers?(options: StartOptions): readonly unknown[];
	/** Makes the translator. AGENT-12 supplies it in the composition root. */
	translator?(options: { adapter: AcpAdapter; logger: RunnerCommonDeps["logger"] }): AcpTranslator;
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

	constructor(protected readonly deps: AcpRunnerDeps) {}

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

	listModels(): Promise<ModelInfo[]> {
		return notImplemented("AGENT-12");
	}

	listSlashCommands(
		_workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
		return notImplemented("AGENT-12");
	}

	private makeTranslator(logger: RunnerCommonDeps["logger"]): AcpTranslator {
		if (this.deps.translator !== undefined) {
			return this.deps.translator({ adapter: this.deps.adapter, logger });
		}
		return new AcpTranslator({ toolNameHints: this.deps.adapter.toolNameHints, logger });
	}
}
