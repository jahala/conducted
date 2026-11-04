/**
 * @feature AGENT-06 Codex: threads, steer, interrupt (runner)
 * Owns: the Runner for Codex: finding the program, its version, starting a CodexSession, listing
 * models.
 * Behaviour: research/conductor/other-runners.md sections 1, 2.1 and 5: models come from
 * `model/list` on a temporary app server (paged, hidden models dropped); the sign-in state from
 * `account/read`; Codex answers slash commands (as skills) and MCP server status.
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
import type { ModelInfo } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import type { SpawnJsonRpcChild } from "./app-server-client.ts";

export type CodexRunnerDeps = RunnerCommonDeps & {
	spawn: SpawnJsonRpcChild;
	random(): number;
	sleep(ms: number): Promise<void>;
	/** Builds the `--config` arguments that register the app tools MCP server for a chat. */
	appToolsConfigArgs(options: StartOptions): readonly string[];
};

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

	constructor(protected readonly deps: CodexRunnerDeps) {}

	detect(
		_env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		return notImplemented("AGENT-06");
	}

	start(_options: StartOptions): Promise<AgentSession> {
		return notImplemented("AGENT-06");
	}

	listModels(): Promise<ModelInfo[]> {
		return notImplemented("AGENT-06");
	}

	listSlashCommands(
		_workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
		return notImplemented("AGENT-06");
	}
}
