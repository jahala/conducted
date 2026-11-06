/**
 * @feature SIDE-12 App tools as an in-process MCP server
 * Owns: building the MCP server that Claude gets inside the sidecar process, from the tool
 * registry.
 * Behaviour: research/conductor/claude-runner.md section 4.1: `createSdkMcpServer` from the Agent
 * SDK with name "conducted" and one `tool()` per definition; the CLI reaches it through control
 * messages on the same pipes as the chat; no socket and no extra process. Tool names reach the
 * model as mcp__conducted__<Name>.
 * Must handle:
 *  - a tool's exception becomes an MCP error result with the message, never a crash of the sidecar
 *  - NotImplemented thrown by a placeholder surfaces as an error result that names the feature id
 *  - readOnly and idempotent hints are passed as MCP annotations; AskUserQuestion is always loaded
 *    (not deferred behind tool search), as in Conductor
 * Test first: the returned server config has type "sdk", name "conducted", and one tool per
 * enabled definition.
 */
import {
	createSdkMcpServer,
	type McpSdkServerConfigWithInstance,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import { APP_TOOL_SERVER, type SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { AppToolBackend } from "./backend.ts";
import { enabledTools } from "./registry.ts";

export function createAppToolsServer(deps: {
	sessionId: SessionId;
	appTools: SessionConfig["appTools"];
	backend: AppToolBackend;
	logger: Logger;
}): McpSdkServerConfigWithInstance {
	const tools = enabledTools(deps.appTools, { includeAskUserQuestion: true }).map((definition) =>
		tool(
			definition.name,
			definition.description,
			definition.inputShape,
			async (args) => {
				deps.logger.info("App tool invoked", {
					sessionId: deps.sessionId,
					tool: definition.name,
				});
				try {
					const result = await definition.execute(args, {
						sessionId: deps.sessionId,
						backend: deps.backend,
					});
					return {
						content: [{ type: "text" as const, text: result.text }],
						isError: result.isError,
					};
				} catch (cause) {
					deps.logger.warn("An app tool failed", {
						sessionId: deps.sessionId,
						tool: definition.name,
						reason: messageOf(cause),
					});
					return {
						content: [{ type: "text" as const, text: messageOf(cause) }],
						isError: true,
					};
				}
			},
			{
				annotations: {
					readOnlyHint: definition.readOnly,
					destructiveHint: !definition.readOnly,
					idempotentHint: definition.idempotent,
					openWorldHint: false,
				},
				alwaysLoad: definition.alwaysLoad,
			},
		),
	);
	return createSdkMcpServer({ name: APP_TOOL_SERVER, version: "1.0.0", tools });
}
