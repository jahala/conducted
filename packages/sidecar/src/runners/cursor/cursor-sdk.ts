/**
 * @feature AGENT-09 Cursor: SDK in process (the narrow interface)
 * Owns: the small interface to Cursor's SDK that the Cursor runner needs. Our code never imports
 * the SDK package: load-sdk.ts loads it from the folder the program manager installs it in and
 * hands back these shapes.
 * Behaviour: research/conductor/other-runners.md section 2.3, checked against the type
 * declarations of @cursor/sdk 1.3.1 (`dist/esm/platform.d.ts`, `run.d.ts`, `agent.d.ts`,
 * `options.d.ts`, `messages.d.ts`, `errors.d.ts`), read on 2026-11-06:
 *  - `createAgentPlatform({ stateRoot, workspaceRef })` opens the SDK's own SQLite run store in
 *    `stateRoot`; the platform resumes an agent by id (`resumeAgent`, which throws
 *    AgentNotFoundError for an unknown id) and creates one with a chosen id (`createAgent`)
 *  - the options hold the API key, a model with parameters, the local working folder and the MCP
 *    servers (`{ command, args, env }` or `{ url, headers, auth }`)
 *  - `agent.send(text)` returns a run; `agent.close()` ends the agent
 *  - a run streams messages, `wait()` resolves to a result whose status is finished, error or
 *    cancelled (a failed run does not throw), `steer(text)` resolves to complete_delivered or
 *    revert_to_followup and is absent on runs that cannot be steered, `cancel()` stops it
 *  - a refused key throws the SDK's AuthenticationError (HTTP 401)
 * Where the research and the package differ, the package wins: the research's
 * `createAgentPlatform({ localStore, eventNotifier, workspaceRef })` is the same call with the
 * SDK's default store; the local options have no store folder (the platform's `stateRoot` is it);
 * the SDK has no "error" message type (a failure is the run result's `error`).
 * Must handle: message objects have shapes we do not list (kept as a loose record and checked
 * field by field in translate.ts).
 * Test first: none (types only). AGENT-10 adds translate.test.ts for the messages we do read.
 */
import type { AppError, Result } from "@conducted/shared";

export interface CursorModelParam {
	id: string;
	value: string;
}

export interface CursorAgentOptions {
	apiKey: string;
	model: { id: string; params: CursorModelParam[] };
	local: { cwd: string };
	mcpServers?: Record<string, unknown>;
}

/** One message from a run's stream. Only `type` is relied on; the rest is read defensively. */
export interface CursorSdkMessage {
	type: string;
	[field: string]: unknown;
}

export type CursorSteerOutcome = "complete_delivered" | "revert_to_followup";

/** How a run ended. A failed run resolves with status "error"; it does not throw. */
export interface CursorRunResult {
	status: "finished" | "error" | "cancelled";
	error?: { message: string; code?: string };
}

export interface CursorRun {
	stream(): AsyncIterable<CursorSdkMessage>;
	wait(): Promise<CursorRunResult>;
	/** Absent on runs that cannot be steered. */
	steer?(text: string): Promise<CursorSteerOutcome>;
	cancel(): Promise<void>;
}

export interface CursorAgent {
	send(text: string): Promise<CursorRun>;
	close(): void;
}

/** One workspace's Cursor platform: its run store and the agents in it. */
export interface CursorPlatform {
	createAgent(options: CursorAgentOptions & { agentId: string }): Promise<CursorAgent>;
	resumeAgent(agentId: string, options: CursorAgentOptions): Promise<CursorAgent>;
}

/** The SDK as load-sdk.ts hands it to the runner. */
export interface CursorSdk {
	/** The installed package's version. */
	version: string;
	/** Opens the platform whose run store is `stateRoot`. One platform per store folder. */
	createPlatform(options: { stateRoot: string; workspaceRef: string }): Promise<CursorPlatform>;
	/** True for the SDK's own AuthenticationError: a refused or missing key. */
	isAuthenticationError(error: unknown): boolean;
	/**
	 * Variables that point the SDK at its native package (ripgrep and the shell parser). The SDK
	 * searches for that package beside the running program, which is not where the app installs
	 * it, so these go into the environment of every SDK call.
	 */
	env: Readonly<Record<string, string>>;
}

/** Where the installed SDK is, as the program manager left it. */
export interface CursorSdkLocation {
	/** The folder of the installed tree (`agent-binaries/cursor/current`). */
	folder: string;
	version: string;
}

export interface CursorSdkLoader {
	/** Finds the installed SDK without loading it. Ok(null) when it is not installed. */
	locate(): Promise<Result<CursorSdkLocation | null, AppError>>;
	/** Loads the SDK on first use, then hands back the same one. */
	load(): Promise<Result<CursorSdk, AppError>>;
}

/** Loads the SDK on first use. */
export type LoadCursorSdk = () => Promise<Result<CursorSdk, AppError>>;
