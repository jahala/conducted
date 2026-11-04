/**
 * @feature AGENT-10 Cursor: native tool names to canonical tools
 * Owns: the table from Cursor's tool names to our canonical tools.
 * Behaviour: research/conductor/other-runners.md section 3: Cursor's read and read_file map to the
 * read tool, edit and edit_file to edit, shell to bash, glob to glob, list_dir to list and
 * createPlan to exit_plan_mode; MCP calls are named mcp__<server>__<tool>. Conductor renames to
 * Claude's names; we map to our own canonical names.
 * Must handle: names we do not know (unknown, with the raw name kept by the caller), an MCP name
 * of our own server (app_tool), and case differences (matched exactly; Cursor's names are lower
 * case with underscores, createPlan is the one camel-case name).
 * Test first: canonicalToolForCursor("shell") is "bash" and canonicalToolForCursor("createPlan") is
 * "exit_plan_mode".
 */
import { APP_TOOL_SERVER, type CanonicalTool } from "@conducted/protocol";

export const CURSOR_TOOL_TABLE: Readonly<Record<string, CanonicalTool>> = {
	read: "read",
	read_file: "read",
	edit: "edit",
	edit_file: "edit",
	shell: "bash",
	glob: "glob",
	list_dir: "list",
	createPlan: "exit_plan_mode",
};

export function canonicalToolForCursor(name: string): CanonicalTool {
	if (name.startsWith(`mcp__${APP_TOOL_SERVER}__`)) return "app_tool";
	if (name.startsWith("mcp__")) return "mcp";
	return CURSOR_TOOL_TABLE[name] ?? "unknown";
}
