/**
 * @feature CHAT-08 MCP tool card
 * Owns: The card for a tool from an MCP server: server name, tool name, input and output.
 * Behaviour: frontend.md 5 (context7-mcp, linear-mcp and similar kinds), ui-map.md 3.3.
 * Must handle: Raw name shaped 'mcp__server__tool' (split for the title); input and output as
 * formatted JSON with a Raw toggle; very large output (cut); an error result.
 * Test first: A call named mcp__linear__get_issue renders 'linear' and 'get_issue'.
 */
import { notImplemented } from "@conducted/shared";
import type { ToolCardProps } from "../tool-card-props.ts";

export function McpCard(_props: ToolCardProps): never {
	return notImplemented("CHAT-08");
}
