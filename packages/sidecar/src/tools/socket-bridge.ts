/**
 * @feature SIDE-13 App tools over a socket bridge
 * Owns: the Unix socket inside the sidecar that the app-tools MCP helper (mcp-stdio-server.ts)
 * calls. It authenticates the call, finds the chat, and runs the same tool definitions as the
 * in-process server.
 * Behaviour: research/conductor/claude-runner.md section 4.3: the socket lives in a private temp
 * folder, one per workspace; each chat gets a random token; the bridge serves Codex and ACP agents
 * and is started once per sidecar. Claude does not use it.
 * Must handle:
 *  - socket folder and file are private (mode 0700 and 0600), created per sidecar run, removed on
 *    stop(); a stale folder from a crashed run is left to the OS temp cleaner, never reused
 *  - registerSession(sessionId, appTools) returns the token for that chat; unregisterSession
 *    invalidates it (chat reset, agent restart, shutdown)
 *  - a tool that is off for the chat (appTools switches) answers with an error line
 *  - tokens are compared in constant time
 *  - idle connections close after 30 s; a tool call that runs longer than that keeps its
 *    connection open until it answers (a question tool waits for a person)
 *  - a helper process that never says hello is tolerated; the pid is only logged
 *  - the app disconnects while a call waits: the call answers with the backend's error text
 * Test first: a call with the token of another chat gets an unauthorized error line and the tool
 * does not run.
 * Our design choice: tokens come from a TokenSource parameter (random bytes in production), and
 * the socket folder from a TempDir parameter, so tests control both.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { AppError, Result, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { AppToolBackend } from "./backend.ts";

export interface TokenSource {
	/** A new random token: BRIDGE_TOKEN_BYTES bytes, base64url encoded. */
	newToken(): string;
}

export interface BridgeEndpoint {
	socketPath: string;
}

export class AppToolsBridge {
	constructor(
		protected readonly deps: {
			backend: AppToolBackend;
			tokens: TokenSource;
			logger: Logger;
			/** Makes a private folder and returns its path. */
			makeTempDir(prefix: string): Promise<string>;
		},
	) {}

	start(): Promise<Result<BridgeEndpoint, AppError>> {
		return notImplemented("SIDE-13");
	}

	/** Returns the token the helper process must present for this chat. */
	registerSession(_sessionId: SessionId, _appTools: SessionConfig["appTools"]): string {
		return notImplemented("SIDE-13");
	}

	unregisterSession(_sessionId: SessionId): void {
		notImplemented("SIDE-13");
	}

	stop(): Promise<void> {
		return notImplemented("SIDE-13");
	}
}
