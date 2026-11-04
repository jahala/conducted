/**
 * @feature AGENT-09 Cursor: SDK in process (runner)
 * Owns: the Runner for Cursor: detecting whether it can run, starting a CursorSession, the model
 * list.
 * Behaviour: research/conductor/other-runners.md sections 2.3, 5 and 6: Cursor has no list call, so
 * the model catalog is static; no slash commands, no MCP listing, no context usage; the API key
 * comes from the CURSOR_API_KEY variable or the user's settings (the shell-env capture strips it
 * from the inherited environment, so only an explicit setting counts); a user's own MCP servers in
 * ~/.cursor/mcp.json and <workspace>/.cursor/mcp.json are read and forwarded.
 * Must handle:
 *  - detect(): the `cursor-agent` program on PATH is optional; the runner works through the SDK,
 *    so detect() reports the SDK's presence and version when it can load, else null
 *  - listModels(): a static list owned by this file, written when AGENT-09 is built from Cursor's
 *    documentation; until then the list is not invented (see models/catalog.ts)
 *  - the user's MCP files: a missing file is fine, a broken file is logged and skipped
 *  - capabilities: steer true (when the run supports it), interrupt true, everything else false
 * Test first: capabilities.resumeAt is false and slashCommands is false.
 */
import type { ModelInfo } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { RunnerCommonDeps } from "../deps.ts";
import type { AgentSession, Runner, RunnerCapabilities, StartOptions } from "../runner.ts";
import type { LoadCursorSdk } from "./cursor-sdk.ts";
import type { EnvLock } from "./env-lock.ts";

export type CursorRunnerDeps = RunnerCommonDeps & {
	loadSdk: LoadCursorSdk;
	envLock: EnvLock;
	/** Reads the API key from the user's settings. Undefined when none is set. */
	apiKey(): string | undefined;
};

export class CursorRunner implements Runner {
	readonly agent = "cursor" as const;
	readonly capabilities: RunnerCapabilities = {
		steer: true,
		interrupt: true,
		resumeAt: false,
		liveConfig: false,
		slashCommands: false,
		mcpServers: false,
		contextUsage: false,
	};

	constructor(protected readonly deps: CursorRunnerDeps) {}

	detect(
		_env: Readonly<Record<string, string>>,
	): Promise<{ path: string; version: string } | null> {
		return notImplemented("AGENT-09");
	}

	start(_options: StartOptions): Promise<AgentSession> {
		return notImplemented("AGENT-09");
	}

	listModels(): Promise<ModelInfo[]> {
		return notImplemented("AGENT-09");
	}

	listSlashCommands(
		_workspacePath: string,
	): Promise<{ name: string; description: string; argumentHint?: string }[]> {
		return notImplemented("AGENT-09");
	}
}
