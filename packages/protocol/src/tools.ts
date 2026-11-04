/**
 * Tool names shared by every runner and the chat UI: canonical tool kinds, which of them are
 * read-only, and the tools this app gives to agents.
 */
import { z } from "zod";

/**
 * Canonical tool names. Every runner maps its agent's native tool names onto these, so
 * the chat has one card per tool kind whatever agent produced it.
 * Research: other-runners.md section 3 (Conductor maps Cursor and ACP tools onto Claude's names).
 * Our design choice: the names are ours, and Claude is translated too.
 */
export const CANONICAL_TOOLS = [
	"read",
	"write",
	"edit",
	"multi_edit",
	"notebook_edit",
	"bash",
	"bash_output",
	"glob",
	"grep",
	"list",
	"web_fetch",
	"web_search",
	"sub_agent",
	"todo",
	"ask_user_question",
	"enter_plan_mode",
	"exit_plan_mode",
	"skill",
	"slash_command",
	"app_tool",
	"mcp",
	"unknown",
] as const;
export const zCanonicalTool = z.enum(CANONICAL_TOOLS);
export type CanonicalTool = z.infer<typeof zCanonicalTool>;

/** Tools that cannot change files or run commands. Checkpoints do not wait for these. */
export const READ_ONLY_TOOLS: ReadonlySet<CanonicalTool> = new Set([
	"read",
	"glob",
	"grep",
	"list",
	"web_fetch",
	"web_search",
	"todo",
	"enter_plan_mode",
	"ask_user_question",
]);

/**
 * Tools this app gives to every agent through MCP (server name "conducted").
 * Research: claude-runner.md section 4.2. Cloud-only tools are left out.
 */
export const APP_TOOLS = [
	"AskUserQuestion",
	"GetWorkspaceDiff",
	"GetDiffComments",
	"DiffComment",
	"GetTerminalOutput",
	"UpdateProgress",
	"SetTargetBranch",
] as const;
export const zAppTool = z.enum(APP_TOOLS);
export type AppTool = z.infer<typeof zAppTool>;

export const APP_TOOL_SERVER = "conducted";
