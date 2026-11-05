/**
 * @feature AGENT-03 Claude: translate SDK messages to the neutral format (tool names)
 * Owns: the table from Claude's tool names to our canonical tools, and the read-only test used by
 * the checkpoint hook.
 * Behaviour: research/conductor/claude-runner.md section 1.4 (the read-only set that does not wait
 * for the start checkpoint: Read, Glob, Grep, ToolSearch, LSP, TaskGet, TaskList, TaskOutput,
 * WebFetch, WebSearch, CronList, EnterPlanMode), section 3.2 (edit tools Edit, MultiEdit, Write,
 * NotebookEdit) and section 4.1 (app tools reach the model as mcp__<server>__<Name>).
 * The names are checked against the installed Agent SDK: BUILTIN_TOOL_NAMES lists Read, Write,
 * Edit, NotebookEdit, Bash, Glob, Grep, WebFetch, WebSearch, TodoWrite, AskUserQuestion,
 * EnterPlanMode, ExitPlanMode, Skill and Agent; LEGACY_TOOL_NAME_ALIASES says "Task" is the old
 * name of "Agent". MultiEdit, LS and TaskOutput come from the research (older CLI versions).
 * Must handle: an MCP tool of another server (mcp), one of our own app tools (app_tool), a name we
 * do not know (unknown, with the raw name kept by the caller), and the old name "Task".
 * Test first: canonicalToolFor("mcp__conducted__GetWorkspaceDiff") is "app_tool" and
 * canonicalToolFor("mcp__linear__get_issue") is "mcp".
 */
import { type CanonicalTool, READ_ONLY_TOOLS } from "@conducted/protocol";
import { APP_TOOL_NAME_PREFIX } from "./constants.ts";

export const CLAUDE_TOOL_TABLE: Readonly<Record<string, CanonicalTool>> = {
	Read: "read",
	Write: "write",
	Edit: "edit",
	MultiEdit: "multi_edit",
	NotebookEdit: "notebook_edit",
	Bash: "bash",
	TaskOutput: "bash_output",
	Glob: "glob",
	Grep: "grep",
	LS: "list",
	WebFetch: "web_fetch",
	WebSearch: "web_search",
	Agent: "sub_agent",
	Task: "sub_agent",
	TodoWrite: "todo",
	AskUserQuestion: "ask_user_question",
	EnterPlanMode: "enter_plan_mode",
	ExitPlanMode: "exit_plan_mode",
	Skill: "skill",
	TaskCreate: "task_create",
	TaskGet: "task_get",
	TaskList: "task_list",
	TaskUpdate: "task_update",
	TaskStop: "task_stop",
	Monitor: "monitor",
	ScheduleWakeup: "schedule_wakeup",
	SendMessage: "send_message",
	ToolSearch: "tool_search",
};

export function canonicalToolFor(name: string): CanonicalTool {
	if (name.startsWith(APP_TOOL_NAME_PREFIX)) return "app_tool";
	if (name.startsWith("mcp__")) return "mcp";
	return CLAUDE_TOOL_TABLE[name] ?? "unknown";
}

/** Read-only Claude tools that have no canonical entry in the table above. */
const EXTRA_READ_ONLY = new Set([
	"ToolSearch",
	"LSP",
	"TaskGet",
	"TaskList",
	"TaskOutput",
	"CronList",
]);

/**
 * True when the tool cannot change files or run commands, so it need not wait for the start
 * checkpoint. Our design choice: our own app tools count as read-only here, because they never
 * touch the worktree (SetTargetBranch changes app state, not files).
 */
export function isNonWritingTool(name: string): boolean {
	if (EXTRA_READ_ONLY.has(name)) return true;
	if (name.startsWith(APP_TOOL_NAME_PREFIX)) return true;
	return READ_ONLY_TOOLS.has(canonicalToolFor(name));
}
