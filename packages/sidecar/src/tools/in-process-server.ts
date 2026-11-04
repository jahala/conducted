/**
 * @feature SIDE-12 App tools as an in-process MCP server
 * Owns: building the MCP server that Claude gets inside the sidecar process, from the tool
 * registry.
 * Behaviour: research/conductor/claude-runner.md section 4.1: `createSdkMcpServer` from the Agent
 * SDK with name "conducted" and one `tool()` per definition; the CLI reaches it through control
 * messages on the same pipes as the chat; no socket and no extra process. Tool names reach the
 * model as mcp__conducted__<Name>.
 * Must handle:
 *  - the tool list is fixed when the agent starts; a change of the switches restarts the agent
 *  - a tool's exception becomes an MCP error result with the message, never a crash of the sidecar
 *  - NotImplemented thrown by a placeholder surfaces as an error result that names the feature id
 *  - readOnly and idempotent hints are passed as MCP annotations; AskUserQuestion is always loaded
 *    (not deferred behind tool search), as in Conductor
 *  - the hook that waits for the start checkpoint treats these tools as non-writing
 * Test first: the returned server config has type "sdk", name "conducted", and one tool per
 * enabled definition.
 */
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { AppToolBackend } from "./backend.ts";

export function createAppToolsServer(_deps: {
	sessionId: SessionId;
	appTools: SessionConfig["appTools"];
	backend: AppToolBackend;
	logger: Logger;
}): McpSdkServerConfigWithInstance {
	return notImplemented("SIDE-12");
}
