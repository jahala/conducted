/**
 * @feature AGENT-11 ACP client and runner (runner)
 * Owns: the Runner for one ACP agent. There is one AcpRunner per adapter (OpenCode, Pi), each with
 * the adapter's descriptor.
 * Behaviour: research/conductor/other-runners.md sections 2.2 and 5: the program is found on the
 * login-shell PATH and its version checked against the adapter's minimum; models come from the
 * `model` config option after session/new on a throwaway session (up to 15 s for OpenCode,
 * capped overall at 90 s when probing each model); slash commands come from
 * available_commands_update; sign-in is the agent's own business.
 * Must handle:
 *  - detect(): program missing gives null; version below minimum gives the version with a flag the
 *    detector turns into "update needed" (we return the real version; the comparison is in
 *    models/agent-detection.ts)
 *  - listModels(): the throwaway session is always closed, also on error and on timeout
 *  - listSlashCommands(): from the throwaway session's available commands
 *  - capabilities: interrupt true (session/cancel), steer false, resumeAt false, liveConfig true
 *    (model and options between turns), slashCommands true, mcpServers false, contextUsage true
 * Test first: capabilities.steer is false for both adapters.
 */
import type { ModelInfo } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import type { SpawnAcpChild } from "./acp-client.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";

export type AcpRunnerDeps = RunnerCommonDeps & {
	adapter: AcpAdapter;
	spawn: SpawnAcpChild;
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

	constructor(protected readonly deps: AcpRunnerDeps) {}

	detect(
		_env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		return notImplemented("AGENT-11");
	}

	start(_options: StartOptions): Promise<AgentSession> {
		return notImplemented("AGENT-11");
	}

	listModels(): Promise<ModelInfo[]> {
		return notImplemented("AGENT-12");
	}

	listSlashCommands(
		_workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
		return notImplemented("AGENT-12");
	}
}
