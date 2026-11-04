/**
 * @feature AGENT-09 Cursor: SDK in process (the narrow interface)
 * Owns: the small interface to the Cursor SDK that the Cursor runner needs, and the port that loads
 * the SDK. Our code never imports the SDK package directly.
 * Behaviour: research/conductor/other-runners.md section 2.3: the SDK is loaded lazily in process;
 * an agent is resumed by id and created when resume fails for a reason other than sign-in; the
 * options hold the API key, a model with parameters (fast, effort), the local working folder and
 * the MCP servers; `send` returns a run; the run streams messages, can be awaited, can be steered
 * (outcome "complete_delivered" means delivered) and cancelled.
 * Licence note: @cursor/sdk has a proprietary licence and is not installed in this scaffold, so
 * none of its types are imported. This file describes only what we call. When the package is
 * added, check each member below against its published type definitions and change this file, not
 * the runner.
 * Must handle: the SDK reads process.env for some settings (see env-lock.ts), message objects
 * have shapes we do not list (kept as a loose record and checked field by field in translate.ts),
 * and the SDK may be absent at run time (load() returns an error value, the runner reports "Cursor
 * is not installed").
 * Test first: none (types only). translate.test.ts covers the messages we do read.
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

export type CursorSteerOutcome = "complete_delivered" | (string & {});

export interface CursorRun {
	stream(): AsyncIterable<CursorSdkMessage>;
	wait(): Promise<void>;
	/** Absent on runs that cannot be steered. */
	steer?(text: string): Promise<CursorSteerOutcome>;
	cancel(): Promise<void>;
}

export interface CursorAgent {
	send(text: string): Promise<CursorRun>;
}

export interface CursorSdk {
	createAgent(options: CursorAgentOptions & { agentId: string }): Promise<CursorAgent>;
	resumeAgent(agentId: string, options: CursorAgentOptions): Promise<CursorAgent>;
}

/** Loads the SDK on first use. */
export type LoadCursorSdk = () => Promise<Result<CursorSdk, AppError>>;
