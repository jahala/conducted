/**
 * @feature AGENT-12 ACP adapters for OpenCode and Pi: tool kinds
 * Owns: the table from ACP tool kinds to canonical tools, and the lookup that lets an adapter's
 * name hints override it.
 * Behaviour: research/conductor/other-runners.md section 3: ACP tool output is rewritten into
 * Claude's tool names, with per-adapter hints; ACP plans become a todo list; diff content is
 * shown as an edit. ACP defines ten tool kinds (@agentclientprotocol/sdk ToolKind), and the type
 * below is complete over them, so a new kind in a future SDK breaks the build here.
 * Must handle: a tool with no kind (use the name hint, else unknown), a name hint that conflicts
 * with the kind (the hint wins, because the adapter knows its own tools), a kind that has no good
 * canonical tool (think, switch_mode, other: unknown, shown by the generic card), and a tool name
 * from an MCP server (mcp, or app_tool for our server).
 * Test first: canonicalToolForAcp({ kind: "execute" }, hints) is "bash"; with the name "find" and
 * Pi's hints it is "glob".
 */
import type { ToolKind } from "@agentclientprotocol/sdk";
import { APP_TOOL_SERVER, type CanonicalTool } from "@conducted/protocol";

export const ACP_TOOL_KIND_TABLE: Readonly<Record<ToolKind, CanonicalTool>> = {
	read: "read",
	edit: "edit",
	delete: "edit",
	move: "edit",
	search: "grep",
	execute: "bash",
	think: "unknown",
	fetch: "web_fetch",
	switch_mode: "unknown",
	other: "unknown",
};

export function canonicalToolForAcp(
	tool: { kind?: ToolKind | undefined; name?: string | null | undefined },
	hints: Readonly<Record<string, CanonicalTool>>,
): CanonicalTool {
	const name = tool.name ?? "";
	if (name.startsWith(`mcp__${APP_TOOL_SERVER}__`)) return "app_tool";
	if (name.startsWith("mcp__")) return "mcp";
	const hinted = hints[name];
	if (hinted) return hinted;
	return tool.kind ? ACP_TOOL_KIND_TABLE[tool.kind] : "unknown";
}
