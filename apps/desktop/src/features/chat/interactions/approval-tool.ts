/**
 * @feature CHAT-11 Tool approval card
 * Owns: the approval title for a tool request and whether its decision changes files, worked out
 * from the agent's own tool name.
 * Behaviour: ui-map.md 3.3 (title by tool such as 'Do you want to run this command?' and 'make
 * these changes?'), claude-runner.md 3.2 (edit tools).
 * Our design choice: the interaction carries the agent's own tool name, so this file turns it into
 * the canonical tool from packages/protocol/src/tools.ts before classifying it. Unknown names stay
 * unknown instead of being guessed from substrings.
 * Must handle: our app tools (app_tool), another MCP server's tools (mcp), the old names 'Task'
 * and 'LS', and the snake and camel spellings the runners use.
 * Test first: approvalTitle("mcp__git__git_fetch_x") is 'Do you want to run this tool?' and
 * approvalTitle("MultiEdit") is 'Do you want to make these changes?'.
 */
import { APP_TOOL_SERVER, CANONICAL_TOOLS, type CanonicalTool } from "@conducted/protocol";

/** Native names whose canonical tool cannot be reached by changing the spelling alone. */
const NATIVE_ALIASES: Readonly<Record<string, CanonicalTool>> = {
	todo_write: "todo",
	ls: "list",
	list_dir: "list",
	list_files: "list",
	task: "sub_agent",
	agent: "sub_agent",
	subagent: "sub_agent",
	shell: "bash",
	exec: "bash",
	command: "bash",
	read_file: "read",
	write_file: "write",
	apply_patch: "edit",
	patch: "edit",
	file_change: "edit",
	webfetch: "web_fetch",
	websearch: "web_search",
};

const CANONICAL: ReadonlySet<string> = new Set(CANONICAL_TOOLS);

/** The agent's own tool name in the spelling used by the canonical table. */
function snakeCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[\s-]+/g, "_")
		.toLowerCase();
}

/** The canonical tool for an approval request, or unknown when the name is not one we know. */
export function canonicalToolForApproval(toolName: string): CanonicalTool {
	if (toolName.startsWith(`mcp__${APP_TOOL_SERVER}__`)) return "app_tool";
	if (toolName.startsWith("mcp__")) return "mcp";
	const name = snakeCase(toolName);
	const alias = NATIVE_ALIASES[name];
	if (alias !== undefined) return alias;
	return CANONICAL.has(name) ? (name as CanonicalTool) : "unknown";
}

/** True for the tools whose approval is about changing files. */
export function editsFilesInApproval(toolName: string): boolean {
	const tool = canonicalToolForApproval(toolName);
	return tool === "write" || tool === "edit" || tool === "multi_edit" || tool === "notebook_edit";
}

/** The approval title Conductor shows for each kind of tool (ui-map.md 3.3). */
export function approvalTitle(toolName: string): string {
	if (snakeCase(toolName) === "run_local_command") {
		return "Do you want to run this command on your Mac?";
	}
	switch (canonicalToolForApproval(toolName)) {
		case "bash":
			return "Do you want to run this command?";
		case "write":
		case "edit":
		case "multi_edit":
		case "notebook_edit":
			return "Do you want to make these changes?";
		case "sub_agent":
			return "Do you want to run this agent?";
		case "web_search":
			return "Do you want to do this search?";
		case "web_fetch":
			return "Do you want to fetch this page?";
		default:
			return "Do you want to run this tool?";
	}
}
