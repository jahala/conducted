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
	/** The agent creates a task in its task list. */
	"task_create",
	/** The agent reads one task. */
	"task_get",
	/** The agent lists its tasks. */
	"task_list",
	/** The agent changes a task: status, subject or what it blocks. */
	"task_update",
	/** The agent stops a background task it started. */
	"task_stop",
	/** The agent starts watching a command's output in the background. */
	"monitor",
	/** The agent looks at an image file. */
	"image_view",
	/** The agent generates an image. */
	"image_generation",
	/** The agent runs JavaScript in a Node REPL. */
	"node_repl",
	/** The agent searches for tools it can load. */
	"tool_search",
	/** The agent asks to be woken up later, for example to check on a long job. */
	"schedule_wakeup",
	/** The agent sends a message to another chat. */
	"send_message",
	/** The agent starts or cleans up a team of agents (Claude's Teammate tool, a "swarm"). */
	"teammate",
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
	"task_get",
	"task_list",
	"image_view",
	"tool_search",
]);

/**
 * Tools this app gives to every agent through MCP (server name "conducted").
 * Research: claude-runner.md section 4.2. RunLocalCommand is cloud-only (CLOUD-14): the chat's
 * config offers it only for a cloud workspace, through the `localExecution` switch.
 */
export const APP_TOOLS = [
	"AskUserQuestion",
	"GetWorkspaceDiff",
	"GetDiffComments",
	"DiffComment",
	"GetTerminalOutput",
	"UpdateProgress",
	"SetTargetBranch",
	"RunLocalCommand",
] as const;
export const zAppTool = z.enum(APP_TOOLS);
export type AppTool = z.infer<typeof zAppTool>;

export const APP_TOOL_SERVER = "conducted";

/**
 * RunLocalCommand's limits, from the research (claude-runner.md section 4.2): a command defaults
 * to 60 s, may ask for 120 s, and may ask for up to 30 minutes when it gives an extended-timeout
 * reason. The agent's answer is not waited for beyond 110 s. Output over 32,000 characters goes to
 * a file in the workspace instead of the tool result.
 */
export const LOCAL_COMMAND_DEFAULT_TIMEOUT_MS = 60_000;
export const LOCAL_COMMAND_MAX_TIMEOUT_MS = 120_000;
export const LOCAL_COMMAND_EXTENDED_MAX_TIMEOUT_MS = 1_800_000;
export const LOCAL_COMMAND_APPROVAL_TIMEOUT_MS = 110_000;
export const LOCAL_COMMAND_OUTPUT_FILE_CHARS = 32_000;
/** Where the full output of a long local command is saved, relative to the workspace folder. */
export const LOCAL_COMMAND_OUTPUT_FOLDER = ".context/conductor";

/**
 * The timeout RunLocalCommand is given: the agent's own, clamped to 120 s, or to 30 minutes when
 * it gave an extended-timeout reason. No timeout means 60 s.
 */
export function localCommandTimeoutMs(args: {
	timeoutMs?: number;
	extendedTimeoutReason?: string;
}): number {
	if (args.timeoutMs === undefined || !Number.isFinite(args.timeoutMs)) {
		return LOCAL_COMMAND_DEFAULT_TIMEOUT_MS;
	}
	const cap =
		args.extendedTimeoutReason !== undefined && args.extendedTimeoutReason.trim().length > 0
			? LOCAL_COMMAND_EXTENDED_MAX_TIMEOUT_MS
			: LOCAL_COMMAND_MAX_TIMEOUT_MS;
	return Math.max(1, Math.min(Math.trunc(args.timeoutMs), cap));
}
