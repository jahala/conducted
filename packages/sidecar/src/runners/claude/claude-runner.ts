/**
 * @feature AGENT-02 Claude: Agent SDK in streaming-input mode, resume, fork
 * Owns: the Runner for Claude Code: finding the program, its version and sign-in state, starting a
 * ClaudeSession, listing models and slash commands.
 * Behaviour: research/conductor/claude-runner.md sections 1 and 7, other-runners.md section 5
 * (`claude auth status --json` with a 5 s timeout; the provider routing variables for Bedrock,
 * Vertex and Foundry follow from its answer) and decision 7 in docs/plans/scaffold.md.
 * Must handle:
 *  - detect(): `claude` not on PATH gives null; `claude --version` that hangs gives an error value
 *    after 5 s, reported as installed without a version by the detector
 *  - start() with a missing workspace folder: an error that names the folder
 *  - listModels(): from the live or throwaway query's supportedModels(); efforts from
 *    supportedEffortLevels, fast mode from supportsFastMode; the default effort is the middle of
 *    the list when the SDK gives none (no invented default: if the list is empty, the entry has
 *    no efforts and the picker hides the control)
 *  - listSlashCommands(): from supportedCommands() of a throwaway metadata query; the throwaway
 *    query is always ended, even on error
 *  - capabilities are fixed: steer, interrupt, resumeAt, liveConfig, slashCommands, mcpServers and
 *    contextUsage are all supported
 * Test first: detect() with a findExecutable that returns null resolves to null without probing.
 */
import type { ModelInfo } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import type { ClaudeSessionDeps } from "./claude-session.ts";

export type ClaudeRunnerDeps = RunnerCommonDeps &
	Pick<ClaudeSessionDeps, "query" | "appTools" | "hasTranscript" | "realPath" | "newUuid">;

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

	detect(
		_env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		return notImplemented("AGENT-02");
	}

	start(_options: StartOptions): Promise<AgentSession> {
		return notImplemented("AGENT-02");
	}

	listModels(): Promise<ModelInfo[]> {
		return notImplemented("AGENT-02");
	}

	listSlashCommands(
		_workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
		return notImplemented("AGENT-02");
	}
}
